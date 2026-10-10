/**
 * E54, a pesquisa na hora, do lado do produto: cria o pedido, roda a busca (na fila, `jobs/pesquisa-na-hora.ts`), guarda o que a pessoa
 * marca e o que o roteiro vai poder usar (parte 2). Contrapontos registrados na etapa: é a única parte do produto em que o roteiro não
 * sai só do banco; por isso é pedida e aprovada pela pessoa, tem teto por pesquisa e por marca por dia, e o que entra no roteiro entra
 * como DADO DATADO COM FONTE, igual às vozes do público, nunca como prova de viralizar nem como fato do setor.
 *
 * As travas que decidem o que é dado estão em `conferencia-da-pesquisa.ts` (puras e testadas): a confiança não depende de o modelo
 * acertar. Aqui fica o fluxo, o custo e o que protege o gasto: a pesquisa é REIVINDICADA antes de rodar (duas execuções nunca pagam a
 * mesma busca), qualquer queda vira "erro" com o custo que já houve, e uma que ficou presa é encerrada depois de 15 minutos.
 */
import * as Sentry from "@sentry/node";
import { and, count, eq, gt, gte, inArray, lt, ne, or, sql } from "drizzle-orm";

import { CAMBIO_USD_BRL } from "@/config/dinheiro";
import { dominiosPermitidos } from "@/config/fontes-pesquisa";
import { PRECO_BUSCA_WEB_USD, PRECOS_POR_NIVEL, TOKENS_DE_ENTRADA_POR_BUSCA } from "@/config/precos-ia";
import { db } from "@/db";
import { pesquisasNaHora, type PerguntaDePosicao, type PesquisaNaHora, type PremissaDaPesquisa } from "@/db/schema";
import { buscarNaWeb, ErroDaBusca, type RespostaDaBusca } from "@/ia/busca-na-web";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import * as conferirPremissaIA from "@/ia/prompts/conferirPremissa";
import * as pesquisaIA from "@/ia/prompts/pesquisaNaHora";
import { calcularCustoUsd, registrarGeracao } from "@/ia/registro";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";

import { type DescartesDaPesquisa, marcadosDeInicio, montarAchados, SEM_DESCARTES, sanearConferencia } from "./conferencia-da-pesquisa";
import { limparParaPrompt } from "./noticias-assuntos";
import { inicioDoDiaEmSaoPaulo } from "./noticias-do-dia";

/** Erro que a pessoa pode ler: a frase já vem pronta, em língua de gente. */
export class ErroPesquisa extends Error {}

export type Profundidade = "normal" | "aprofundada";

const PEDIDO_MINIMO = 8;
const PEDIDO_MAXIMO = 300;
const TEMA_MAXIMO = 600;
const IDS_MAXIMO = 50;
/** Uma pesquisa que não terminou em tanto tempo foi encerrada (a fila caiu, o worker parou): lê-se como "erro" e não ocupa o teto. */
const PRAZO_DA_PESQUISA_MS = 15 * 60 * 1000;
/** A primeira chave do trava do teto por marca (a segunda é o id da marca). */
const TRAVA_DA_E54 = 54;

const MOTIVO_SEM_ACHADOS =
  "Não achamos dado confiável sobre isso nas fontes que a gente usa (portais grandes e órgãos oficiais). Dá para escrever sem pesquisa, ou pedir de outro jeito.";
const MOTIVO_DE_ERRO = "A pesquisa não terminou. Tente de novo em alguns minutos, ou escreva sem pesquisa.";
const MOTIVO_PRESA = "A pesquisa demorou mais do que devia e foi encerrada. Tente de novo, ou escreva sem pesquisa.";

// ---------------------------------------------------------------------------------------------------------------------
// Custo estimado, para a tela dizer antes de rodar
// ---------------------------------------------------------------------------------------------------------------------

export type EstimativaDaPesquisa = { buscas: number; usd: number; reais: number };

/**
 * O custo estimado de uma pesquisa, em língua de gente na tela ("uns R$ 0,50"): as buscas a US$ 0,01 mais o conteúdo achado como
 * entrada (uns 6.000 tokens por busca) no modelo barato, mais uma saída curta. É o pior caso do teto de buscas; o custo de verdade fica
 * em `pesquisas_na_hora.custo_usd`, e a estimativa pode ficar abaixo quando as buscas reenviam o conteúdo (a provar com a chave real).
 */
export function estimarPesquisa(profundidade: Profundidade): EstimativaDaPesquisa {
  const buscas = profundidade === "aprofundada" ? config.regras.pesquisaNaHoraBuscasAprofundada : config.regras.pesquisaNaHoraBuscas;
  const tokensDeEntrada = buscas * TOKENS_DE_ENTRADA_POR_BUSCA;
  const usd = buscas * PRECO_BUSCA_WEB_USD + (tokensDeEntrada * PRECOS_POR_NIVEL.barato.entrada) / 1_000_000 + (1_500 * PRECOS_POR_NIVEL.barato.saida) / 1_000_000;
  return { buscas, usd, reais: usd * CAMBIO_USD_BRL };
}

// ---------------------------------------------------------------------------------------------------------------------
// Criar, ler, marcar
// ---------------------------------------------------------------------------------------------------------------------

/** Encerra as pesquisas da marca que passaram do prazo sem terminar (a fila caiu ou o worker parou no meio). */
export async function encerrarPesquisasParadas(clienteId: number | null = null, agora: Date = new Date()): Promise<void> {
  await db()
    .update(pesquisasNaHora)
    .set({ status: "erro", motivo: MOTIVO_PRESA, terminadoEm: agora })
    .where(
      and(
        clienteId === null ? undefined : eq(pesquisasNaHora.clienteId, clienteId),
        inArray(pesquisasNaHora.status, ["pesquisando", "executando"]),
        lt(pesquisasNaHora.criadoEm, new Date(agora.getTime() - PRAZO_DA_PESQUISA_MS)),
      ),
    );
}

function pesquisasQueGastaramHoje(clienteId: number, agora: Date) {
  return and(
    eq(pesquisasNaHora.clienteId, clienteId),
    gte(pesquisasNaHora.criadoEm, inicioDoDiaEmSaoPaulo(agora)),
    // A que deu erro sem ter feito nenhuma busca não custou nada e não conta; a que fez busca e caiu depois custou, e conta.
    or(ne(pesquisasNaHora.status, "erro"), gt(pesquisasNaHora.buscas, 0)),
  );
}

/** Pesquisas que gastaram nesta marca desde o começo do dia. */
export async function pesquisasDeHoje(clienteId: number, agora: Date = new Date()): Promise<number> {
  await encerrarPesquisasParadas(clienteId, agora);
  const [linha] = await db().select({ n: count() }).from(pesquisasNaHora).where(pesquisasQueGastaramHoje(clienteId, agora));
  return Number(linha?.n ?? 0);
}

function frasePorTeto(): string {
  const teto = config.regras.pesquisasNaHoraPorMarcaPorDia;
  return `Você já fez ${teto} ${teto === 1 ? "pesquisa" : "pesquisas"} hoje. Amanhã tem mais; hoje dá para escrever com o que a gente já sabe do seu setor.`;
}

/** O teto por marca por dia. Lança `ErroPesquisa` com a frase pronta. */
export async function exigirFolgaDaPesquisa(clienteId: number, agora: Date = new Date()): Promise<void> {
  if ((await pesquisasDeHoje(clienteId, agora)) >= config.regras.pesquisasNaHoraPorMarcaPorDia) throw new ErroPesquisa(frasePorTeto());
}

export type PedidoDePesquisa = { pedido: string; tema?: string | null; profundidade?: Profundidade };

/**
 * Manda a pesquisa para a fila (por evento: a pessoa pediu). Uma chave por pesquisa evita que o toque duplo rode a mesma duas vezes; a
 * fila não repete sozinha (cada tentativa gasta busca paga), então uma que cai vira "A pesquisa não terminou" e a pessoa decide.
 */
export async function enfileirarPesquisaNaHora(pesquisaId: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.pesquisaNaHora, { pesquisaId }, { singletonKey: `pesquisa-na-hora-${pesquisaId}`, singletonSeconds: 3600 });
}

/**
 * Cria a pesquisa e a deixa na fila (`enfileirar` é injetável: o teste não precisa do pg-boss). A conferência do tamanho e do teto
 * é daqui, nunca da tela, e a contagem do teto e a gravação acontecem sob uma trava por marca (duas abas ao mesmo tempo não passam do
 * teto). Devolve a pesquisa já gravada, "pesquisando".
 */
export async function criarPesquisa(
  clienteId: number,
  dados: PedidoDePesquisa,
  deps: { enfileirar?: (pesquisaId: number) => Promise<void>; agora?: Date } = {},
): Promise<PesquisaNaHora> {
  const agora = deps.agora ?? new Date();
  const pedido = limparParaPrompt(dados.pedido, PEDIDO_MAXIMO + 1).trim();
  if (pedido.length < PEDIDO_MINIMO) throw new ErroPesquisa("Escreva em uma frase o que você quer pesquisar.");
  if (pedido.length > PEDIDO_MAXIMO) throw new ErroPesquisa(`Escreva o pedido em até ${PEDIDO_MAXIMO} caracteres.`);
  const tema = dados.tema ? limparParaPrompt(dados.tema, TEMA_MAXIMO) : null;

  await encerrarPesquisasParadas(clienteId, agora);
  const linha = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${TRAVA_DA_E54}, ${clienteId})`);
    const [{ n }] = await tx.select({ n: count() }).from(pesquisasNaHora).where(pesquisasQueGastaramHoje(clienteId, agora));
    if (Number(n) >= config.regras.pesquisasNaHoraPorMarcaPorDia) throw new ErroPesquisa(frasePorTeto());
    const [nova] = await tx
      .insert(pesquisasNaHora)
      .values({ clienteId, pedido, tema: tema || null, profundidade: dados.profundidade === "aprofundada" ? "aprofundada" : "normal" })
      .returning();
    return nova;
  });

  try {
    await (deps.enfileirar ?? enfileirarPesquisaNaHora)(linha.id);
  } catch (erro) {
    logger.error({ err: erro, pesquisaId: linha.id }, "nao foi possivel enfileirar a pesquisa na hora");
    await db().update(pesquisasNaHora).set({ status: "erro", motivo: MOTIVO_DE_ERRO, terminadoEm: new Date() }).where(eq(pesquisasNaHora.id, linha.id));
    throw new ErroPesquisa("Não conseguimos começar a pesquisa agora. Tente de novo em alguns minutos, ou escreva sem pesquisa.");
  }
  return linha;
}

/** A pesquisa de uma marca (nunca a de outra: o escopo é a marca da sessão). Uma que passou do prazo sem terminar volta como erro. */
export async function lerPesquisa(clienteId: number, pesquisaId: number, agora: Date = new Date()): Promise<PesquisaNaHora | null> {
  await encerrarPesquisasParadas(clienteId, agora);
  const [linha] = await db()
    .select()
    .from(pesquisasNaHora)
    .where(and(eq(pesquisasNaHora.id, pesquisaId), eq(pesquisasNaHora.clienteId, clienteId)));
  return linha ?? null;
}

/** O que a pessoa marcou para o roteiro: só ids que existem nos achados, sem repetir, na ordem dos achados. */
export async function marcarAchados(clienteId: number, pesquisaId: number, ids: number[]): Promise<number[]> {
  if (!Array.isArray(ids) || ids.length > IDS_MAXIMO || ids.some((id) => !Number.isInteger(id))) throw new ErroPesquisa("Não entendemos quais dados você marcou.");
  const pesquisa = await lerPesquisa(clienteId, pesquisaId);
  if (!pesquisa || pesquisa.status !== "pronta") throw new ErroPesquisa("Essa pesquisa não está pronta para marcar.");
  const marcados = pesquisa.achados.map((a) => a.id).filter((id) => ids.includes(id));
  await db().update(pesquisasNaHora).set({ selecionados: marcados }).where(eq(pesquisasNaHora.id, pesquisa.id));
  return marcados;
}

/** A resposta da pessoa à "uma pergunta antes de escrever" (a opção marcada ou o que ela escreveu), até 300 caracteres. */
export async function registrarPosicao(clienteId: number, pesquisaId: number, posicao: string): Promise<void> {
  const pesquisa = await lerPesquisa(clienteId, pesquisaId);
  if (!pesquisa) throw new ErroPesquisa("Pesquisa não encontrada.");
  const texto = limparParaPrompt(typeof posicao === "string" ? posicao : "", 300);
  if (texto === "") throw new ErroPesquisa('Diga qual é a sua posição, ou escolha "Prefiro não dar opinião".');
  await db().update(pesquisasNaHora).set({ posicaoDaPessoa: texto }).where(eq(pesquisasNaHora.id, pesquisa.id));
}

const DECISOES = ["fontes", "mudar", "manter"] as const;

/** O que a pessoa decidiu diante de "as fontes dizem outra coisa". Sem aviso, não há o que decidir. */
export async function decidirPremissa(clienteId: number, pesquisaId: number, decisao: (typeof DECISOES)[number]): Promise<void> {
  if (!DECISOES.includes(decisao)) throw new ErroPesquisa("Não entendemos a sua escolha.");
  const pesquisa = await lerPesquisa(clienteId, pesquisaId);
  if (!pesquisa || pesquisa.premissa?.situacao !== "nao_confere") throw new ErroPesquisa("Essa pesquisa não tem um aviso para você decidir.");
  await db().update(pesquisasNaHora).set({ decisaoDaPremissa: decisao }).where(eq(pesquisasNaHora.id, pesquisa.id));
}

// ---------------------------------------------------------------------------------------------------------------------
// Rodar (o job)
// ---------------------------------------------------------------------------------------------------------------------

export type DepsDaPesquisa = {
  buscar?: typeof buscarNaWeb;
  agora?: Date;
};

export type ResumoDaPesquisa = {
  pesquisaId: number;
  status: PesquisaNaHora["status"];
  achados: number;
  buscas: number;
  custoUsd: number;
  descartes: DescartesDaPesquisa;
};

/** O que a pessoa leu e o que o Sentry deve saber: erro de configuração (busca desligada, chave, saldo) não se resolve tentando de novo. */
function ehErroDeConfiguracao(erro: unknown): boolean {
  return erro instanceof Error && /erro da API \((400|401|402|403)\)/.test(erro.message);
}

/** A data de hoje por extenso, no fuso de São Paulo (o fuso do processo é o da VPS). */
function hojePorExtenso(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(agora);
}

/**
 * Roda uma pesquisa criada. REIVINDICA primeiro (`pesquisando` vira `executando` numa só instrução): uma segunda execução da mesma
 * pesquisa (o worker e `npm run job`, ou uma reentrega) não gasta nada. Nunca lança por causa da busca: a pessoa vê "A pesquisa não
 * terminou", o motivo técnico vai para o log, e o gasto que já houve é registrado e conta no teto do dia.
 */
export async function executarPesquisa(pesquisaId: number, deps: DepsDaPesquisa = {}): Promise<ResumoDaPesquisa> {
  const agora = deps.agora ?? new Date();
  const vazio: ResumoDaPesquisa = { pesquisaId, status: "erro", achados: 0, buscas: 0, custoUsd: 0, descartes: { ...SEM_DESCARTES } };

  const [pesquisa] = await db()
    .update(pesquisasNaHora)
    .set({ status: "executando" })
    .where(and(eq(pesquisasNaHora.id, pesquisaId), eq(pesquisasNaHora.status, "pesquisando")))
    .returning();
  if (!pesquisa) {
    const [atual] = await db().select({ status: pesquisasNaHora.status }).from(pesquisasNaHora).where(eq(pesquisasNaHora.id, pesquisaId));
    return { ...vazio, status: atual?.status ?? "erro" };
  }

  const maxBuscas = pesquisa.profundidade === "aprofundada" ? config.regras.pesquisaNaHoraBuscasAprofundada : config.regras.pesquisaNaHoraBuscas;
  const buscar = deps.buscar ?? buscarNaWeb;
  const inicio = Date.now();
  /** O que já foi cobrado, atualizado assim que a busca volta: se qualquer passo seguinte cair, o gasto não se perde. */
  const gasto = { buscas: 0, custoUsd: 0 };

  try {
    let resposta: RespostaDaBusca;
    try {
      resposta = await buscar({
        sistemaEstavel: pesquisaIA.montarSistemaEstavel(),
        entrada: pesquisaIA.montarEntrada({ pedido: pesquisa.pedido, tema: pesquisa.tema, hoje: hojePorExtenso(agora) }),
        maxBuscas,
        dominios: dominiosPermitidos(),
      });
    } catch (erro) {
      if (erro instanceof ErroDaBusca && (erro.usoParcial.buscasNaWeb ?? 0) > 0) {
        gasto.buscas = erro.usoParcial.buscasNaWeb ?? 0;
        gasto.custoUsd = calcularCustoUsd("barato", erro.usoParcial);
        await registrarGeracao({
          tarefa: "pesquisaNaHora",
          versaoPrompt: pesquisaIA.versao,
          modelo: config.ia.modeloBarato,
          nivel: pesquisaIA.nivel,
          clienteId: pesquisa.clienteId,
          entradas: { pedido: pesquisa.pedido, tema: pesquisa.tema, maxBuscas },
          saida: { erro: true, buscas: gasto.buscas },
          uso: erro.usoParcial,
          duracaoMs: Date.now() - inicio,
        });
      }
      throw erro;
    }

    gasto.buscas = resposta.buscas;
    gasto.custoUsd = calcularCustoUsd("barato", resposta.uso);
    const { achados, descartes } = montarAchados(resposta, { agora });
    await registrarGeracao({
      tarefa: "pesquisaNaHora",
      versaoPrompt: pesquisaIA.versao,
      modelo: resposta.modelo,
      nivel: pesquisaIA.nivel,
      clienteId: pesquisa.clienteId,
      entradas: { pedido: pesquisa.pedido, tema: pesquisa.tema, maxBuscas, dominios: dominiosPermitidos().length },
      saida: { linhas: resposta.linhas.length, achados: achados.length, descartes, buscas: resposta.buscas, errosDaFerramenta: resposta.errosDaFerramenta },
      uso: resposta.uso,
      duracaoMs: Date.now() - inicio,
    });

    if (achados.length === 0) {
      await db()
        .update(pesquisasNaHora)
        .set({ status: "sem_achados", motivo: MOTIVO_SEM_ACHADOS, buscas: resposta.buscas, custoUsd: gasto.custoUsd.toFixed(6), terminadoEm: new Date() })
        .where(and(eq(pesquisasNaHora.id, pesquisaId), eq(pesquisasNaHora.status, "executando")));
      return { ...vazio, status: "sem_achados", buscas: resposta.buscas, custoUsd: gasto.custoUsd, descartes };
    }

    // O passo 2: a premissa e a posição. Se ele falhar, a pesquisa continua valendo (os dados já estão conferidos).
    let conferencia: { premissa: PremissaDaPesquisa; perguntaDePosicao: PerguntaDePosicao | null } | null = null;
    try {
      const t0 = Date.now();
      const resultado = await gerarEstruturado({
        tarefa: "conferirPremissa",
        nivel: conferirPremissaIA.nivel,
        effort: conferirPremissaIA.esforco,
        schema: conferirPremissaIA.schema,
        sistemaEstavel: conferirPremissaIA.montarSistemaEstavel(),
        entrada: conferirPremissaIA.montarEntrada({
          tema: pesquisa.tema ?? pesquisa.pedido,
          achados: achados.map((a) => ({ id: a.id, texto: a.texto, fonte: a.fonteNome, data: a.dataDaPagina, citacao: a.citacao })),
        }),
      });
      const uso = {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      };
      gasto.custoUsd += calcularCustoUsd("barato", uso);
      conferencia = sanearConferencia(resultado.dados, achados);
      await registrarGeracao({
        tarefa: "conferirPremissa",
        versaoPrompt: conferirPremissaIA.versao,
        modelo: resultado.modelo,
        nivel: conferirPremissaIA.nivel,
        clienteId: pesquisa.clienteId,
        entradas: { pesquisaId, dados: achados.length },
        saida: { situacao: conferencia.premissa.situacao, perguntaDePosicao: conferencia.perguntaDePosicao !== null },
        uso,
        duracaoMs: Date.now() - t0,
      });
    } catch (erro) {
      if (!(erro instanceof ErroIA)) logger.error({ err: erro, pesquisaId }, "a conferencia da premissa quebrou");
      else logger.warn({ err: erro, pesquisaId }, "a conferencia da premissa nao terminou; a pesquisa segue sem ela");
    }

    await db()
      .update(pesquisasNaHora)
      .set({
        status: "pronta",
        achados,
        selecionados: marcadosDeInicio(achados),
        premissa: conferencia?.premissa ?? null,
        perguntaDePosicao: conferencia?.perguntaDePosicao ?? null,
        buscas: resposta.buscas,
        custoUsd: gasto.custoUsd.toFixed(6),
        terminadoEm: new Date(),
      })
      .where(and(eq(pesquisasNaHora.id, pesquisaId), eq(pesquisasNaHora.status, "executando")));
    return { pesquisaId, status: "pronta", achados: achados.length, buscas: resposta.buscas, custoUsd: gasto.custoUsd, descartes };
  } catch (erro) {
    logger.warn({ err: erro, pesquisaId, buscas: gasto.buscas }, "a pesquisa na hora nao terminou");
    // Busca desligada, chave, saldo: não passa tentando de novo, e a pessoa só vê "não terminou". Quem precisa saber é a gente.
    if (ehErroDeConfiguracao(erro)) Sentry.captureException(erro, { tags: { job: FILAS.pesquisaNaHora, pesquisaId: String(pesquisaId) } });
    await db()
      .update(pesquisasNaHora)
      .set({ status: "erro", motivo: MOTIVO_DE_ERRO, buscas: gasto.buscas, custoUsd: gasto.custoUsd.toFixed(6), terminadoEm: new Date() })
      .where(and(eq(pesquisasNaHora.id, pesquisaId), inArray(pesquisasNaHora.status, ["pesquisando", "executando"])));
    return { ...vazio, status: "erro", buscas: gasto.buscas, custoUsd: gasto.custoUsd };
  }
}
