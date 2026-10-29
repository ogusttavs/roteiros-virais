/**
 * E61 PR 3 (28/10/2026), a pesquisa do foco, do lado do produto: o que se busca para uma conta com foco CONFIRMADO ter prova do assunto dela no banco do setor.
 *
 * A coleta continua por setor. O foco é estreito ("marketing e automação com IA, para donos de pequena empresa"), e o banco do setor pode não ter vídeo desse assunto; então, UMA vez quando o foco é
 * confirmado ou muda (nunca todo dia), o modelo barato o traduz em frases de busca e em canais de referência (`derivarBuscaDoFoco`), guardados em `pesquisa_do_foco` por conta. O job
 * (`jobs/pesquisa-do-foco.ts`) usa isso todo dia, com teto por conta, só com a API do YouTube dentro da cota gratuita (nada de Apify).
 *
 * Aqui ficam: as partes puras (limpar o que o modelo devolve), a derivação (registrada em `geracoes_ia` com o `clienteId`), o gasto do dia por conta e o pedido pela fila. Tudo é de uma conta só:
 * recebe o `clienteId` e filtra por ele; as frases e os canais de uma conta nunca aparecem para outra, e os vídeos achados entram no banco do setor sem marca do que os trouxe.
 */
import { and, count, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientes, geracoesIA, nichos, pesquisaDoFoco, pesquisaDoFocoDia, videos, type CanalDoFoco, type PesquisaDoFoco } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import * as derivarIA from "@/ia/prompts/derivarBuscaDoFoco";
import { registrarGeracao } from "@/ia/registro";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";

import { inicioDoDiaEmSaoPaulo } from "./noticias-do-dia";
import { limparPalavrasSugeridas } from "./palavras-do-assunto";
import { CONTA_DO_SETOR, DENTRO_DO_TETO_DE_DURACAO, reguaDoSetor } from "./pesquisa";
import { hashDoFoco } from "./temas-da-conta";

export class ErroPesquisaDoFoco extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "ia_fora" | "sem_termos" | "limite_do_dia" | "sem_ramo",
  ) {
    super(mensagem);
    this.name = "ErroPesquisaDoFoco";
  }
}

/** Quantas derivações novas uma conta faz por dia: quem troca o foco de dez em dez minutos não repete o gasto (cada uma custa uma fração de centavo). */
export const DERIVACOES_POR_CONTA_POR_DIA = 6;
/** O mínimo de palavras de uma frase de busca: uma palavra só traz qualquer vídeo. */
const PALAVRAS_MINIMAS_DA_FRASE = 2;
const HANDLE = /^[\p{L}\p{N}._-]{3,30}$/u;
const DIA_MS = 24 * 60 * 60 * 1000;
const JANELA_DA_PROVA_DIAS = 30;

// ---------------------------------------------------------------------------------------------------------------------
// Puras
// ---------------------------------------------------------------------------------------------------------------------

/**
 * As frases de busca que o modelo deu, limpas por código: sem aspas, hashtag, travessão nem emoji; de 2 a 5 palavras (sobra palavra solta e frase de uma palavra, que traz qualquer vídeo);
 * sem repetir; no máximo `MAXIMO_DE_TERMOS`. Reaproveita a limpeza das palavras dos assuntos de notícia (`limparPalavrasSugeridas`).
 */
export function limparTermosDoFoco(brutos: readonly string[]): string[] {
  return limparPalavrasSugeridas(brutos)
    .filter((frase) => {
      const palavras = frase.split(" ").length;
      return palavras >= PALAVRAS_MINIMAS_DA_FRASE && palavras <= 6;
    })
    .slice(0, derivarIA.MAXIMO_DE_TERMOS);
}

/**
 * Os @ de canal que o modelo deu, só os que PARECEM um @ de verdade (letras, números, ponto, hífen e sublinhado, de 3 a 30), sem repetir, com o @ na frente. Um endereço, um nome com espaço ou
 * um @@ não passa. Parecer não basta: o job só usa o canal depois de a API do YouTube confirmar que ele existe.
 */
export function limparCanaisSugeridos(brutos: readonly string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of brutos) {
    const sem = bruto.trim().replace(/^@/, "");
    if (!HANDLE.test(sem)) continue;
    const chave = sem.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(`@${sem}`);
    if (saida.length >= derivarIA.MAXIMO_DE_CANAIS) break;
  }
  return saida;
}

/**
 * Reparte as vagas entre as fontes na vez (uma de cada, de novo e de novo) até `limite`, sem repetir: assim as buscas e os canais de referência dividem o teto de vídeos, em vez da primeira
 * fonte levar tudo. Cada fonte já vem na ordem em que importa (a busca, por visualizações).
 */
export function intercalarSemRepetir(fontes: readonly (readonly string[])[], limite: number): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  const posicoes = fontes.map(() => 0);
  let andou = true;
  while (saida.length < limite && andou) {
    andou = false;
    for (let i = 0; i < fontes.length && saida.length < limite; i += 1) {
      while (posicoes[i] < fontes[i].length) {
        const id = fontes[i][posicoes[i]++];
        if (vistos.has(id)) continue;
        vistos.add(id);
        saida.push(id);
        andou = true;
        break;
      }
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ler e derivar
// ---------------------------------------------------------------------------------------------------------------------

/** A pesquisa guardada da conta, só se for do foco de AGORA (o hash confere): quem muda ou tira o foco deixa de ter a pesquisa do foco antigo na hora. */
export async function pesquisaDoFocoDaConta(clienteId: number, foco: string): Promise<PesquisaDoFoco | null> {
  const [linha] = await db().select().from(pesquisaDoFoco).where(eq(pesquisaDoFoco.clienteId, clienteId));
  return linha && linha.focoHash === hashDoFoco(foco) ? linha : null;
}

/**
 * Deriva as frases de busca e os canais sugeridos do foco confirmado e guarda (refazendo a linha da conta se o foco era outro). Uma chamada ao modelo barato, registrada em `geracoes_ia` com o
 * `clienteId`. Com teto de `DERIVACOES_POR_CONTA_POR_DIA` por conta e por dia. Lança `ErroPesquisaDoFoco` com o motivo; o job conta como falha daquela conta e tenta de novo na rodada seguinte.
 */
export async function derivarBuscaDoFoco(clienteId: number, foco: string, agora: Date = new Date()): Promise<PesquisaDoFoco> {
  const [conta] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, clienteId));
  const [pedidos] = await db()
    .select({ total: count() })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "derivarBuscaDoFoco"), eq(geracoesIA.clienteId, clienteId), gte(geracoesIA.criadoEm, inicioDoDiaEmSaoPaulo(agora))));
  if ((pedidos?.total ?? 0) >= DERIVACOES_POR_CONTA_POR_DIA) throw new ErroPesquisaDoFoco("teto diario de derivacoes da conta", "limite_do_dia");

  let ramo: string | null = null;
  if (conta?.nichoId) {
    const [nicho] = await db().select({ nome: nichos.nome }).from(nichos).where(eq(nichos.id, conta.nichoId));
    ramo = nicho?.nome ?? null;
  }

  const entrada = derivarIA.montarEntrada({ foco, ramo });
  const inicio = Date.now();
  let saida;
  try {
    saida = await gerarEstruturado({
      tarefa: "derivarBuscaDoFoco",
      nivel: derivarIA.nivel,
      effort: derivarIA.esforco,
      schema: derivarIA.schema,
      sistemaEstavel: derivarIA.montarSistemaEstavel(),
      entrada,
      maxTokens: 500,
    });
  } catch (erro) {
    if (erro instanceof ErroIA) throw new ErroPesquisaDoFoco("a IA nao respondeu", "ia_fora");
    throw erro;
  }

  const termos = limparTermosDoFoco(saida.dados.termos);
  const canaisSugeridos = limparCanaisSugeridos(saida.dados.canais);

  // O registro é do custo e da auditoria: se ele falhar, a derivação que já foi paga não se perde.
  try {
    await registrarGeracao({
      tarefa: "derivarBuscaDoFoco",
      versaoPrompt: derivarIA.versao,
      modelo: saida.modelo,
      nivel: derivarIA.nivel,
      clienteId,
      entradas: { entrada },
      saida: { ...saida.dados, termosUsados: termos, canaisUsados: canaisSugeridos },
      uso: { tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, tokensCacheLeitura: saida.tokensCacheLeitura, tokensCacheEscrita: saida.tokensCacheEscrita },
      duracaoMs: Date.now() - inicio,
    });
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "nao registrou a geracao da busca do foco");
  }

  if (termos.length === 0) throw new ErroPesquisaDoFoco("o modelo nao deu nenhuma frase de busca que sirva", "sem_termos");

  const valores = { focoUsado: foco, focoHash: hashDoFoco(foco), termos, canaisSugeridos, canais: [] as CanalDoFoco[], conferidosEm: null, ultimaColetaEm: null };
  const [linha] = await db()
    .insert(pesquisaDoFoco)
    .values({ clienteId, ...valores })
    .onConflictDoUpdate({ target: pesquisaDoFoco.clienteId, set: valores })
    .returning();
  return linha;
}

// ---------------------------------------------------------------------------------------------------------------------
// O gasto do dia, por conta
// ---------------------------------------------------------------------------------------------------------------------

export type GastoDoDia = { buscas: number; unidades: number; videos: number };

export async function gastoDoDia(clienteId: number, data: string = hojeISO()): Promise<GastoDoDia> {
  const [linha] = await db()
    .select({ buscas: pesquisaDoFocoDia.buscas, unidades: pesquisaDoFocoDia.unidades, videos: pesquisaDoFocoDia.videos })
    .from(pesquisaDoFocoDia)
    .where(and(eq(pesquisaDoFocoDia.clienteId, clienteId), eq(pesquisaDoFocoDia.data, data)));
  return linha ?? { buscas: 0, unidades: 0, videos: 0 };
}

/** Soma ao gasto do dia da conta (cria a linha do dia se for a primeira). Uma ida ao banco. */
export async function somarAoGastoDoDia(clienteId: number, soma: Partial<GastoDoDia>, data: string = hojeISO()): Promise<void> {
  const buscas = soma.buscas ?? 0;
  const unidades = soma.unidades ?? 0;
  const videosGuardados = soma.videos ?? 0;
  await db()
    .insert(pesquisaDoFocoDia)
    .values({ clienteId, data, buscas, unidades, videos: videosGuardados })
    .onConflictDoUpdate({
      target: [pesquisaDoFocoDia.clienteId, pesquisaDoFocoDia.data],
      set: {
        buscas: sql`${pesquisaDoFocoDia.buscas} + ${buscas}`,
        unidades: sql`${pesquisaDoFocoDia.unidades} + ${unidades}`,
        videos: sql`${pesquisaDoFocoDia.videos} + ${videosGuardados}`,
      },
    });
}

/** As unidades da cota do YouTube que a pesquisa do foco já gastou hoje, de TODAS as contas (o teto `focoUnidadesPorDia` é de todas juntas). */
export async function unidadesDoFocoHoje(data: string = hojeISO()): Promise<number> {
  const [linha] = await db()
    .select({ total: sql<number>`coalesce(sum(${pesquisaDoFocoDia.unidades}), 0)::int` })
    .from(pesquisaDoFocoDia)
    .where(eq(pesquisaDoFocoDia.data, data));
  return Number(linha?.total ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// A prova que o banco já tem (a busca por significado do banco, sem custo)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Quantos vídeos analisados do setor, dos últimos 30 dias e acima do piso, já tratam do assunto de alguma das frases de busca (a busca de texto do banco, com radical e sem acento, a mesma
 * que a busca por significado usa para ordenar os candidatos; sem chamar IA). Com `config.regras.focoProvaSuficiente` ou mais, o setor já tem prova do assunto e a pesquisa não gasta busca hoje.
 * A frase só casa quando TODAS as palavras dela aparecem no vídeo.
 */
export async function provasDoFocoNoBanco(nichoId: number, termos: readonly string[], agora: Date = new Date()): Promise<number> {
  if (termos.length === 0) return 0;
  const regua = await reguaDoSetor(nichoId);
  const algumaFrase = sql.join(
    termos.map((t) => sql`${videos.buscaSemAcento} @@ (select plainto_tsquery('portuguese', f_unaccent(${t}::text)))`),
    sql` or `,
  );
  const [linha] = await db()
    .select({ total: count() })
    .from(videos)
    .where(
      and(
        eq(videos.nichoId, nichoId),
        gte(videos.views, regua.pisoViews),
        gte(videos.publicadoEm, new Date(agora.getTime() - JANELA_DA_PROVA_DIAS * DIA_MS)),
        sql`${videos.analise} is not null`,
        sql`${videos.origem} <> 'seed'`,
        CONTA_DO_SETOR,
        DENTRO_DO_TETO_DE_DURACAO,
        sql`(${algumaFrase})`,
      ),
    );
  return Number(linha?.total ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pedir pela fila
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A pessoa confirmou ou mudou o foco: pede a pesquisa dele na hora (no máximo uma vez por foco a cada 10 minutos), só para esta conta. Nunca derruba quem chama: fila fora do ar é só "não pediu", e a
 * pesquisa roda na madrugada de qualquer jeito.
 */
export async function pedirPesquisaDoFoco(clienteId: number, foco: string): Promise<"pedido" | "nao"> {
  try {
    await garantirBossPronto();
    const id = await boss().send(FILAS.pesquisaDoFoco, { clienteId }, { singletonKey: `pesquisa-do-foco-${clienteId}-${hashDoFoco(foco)}`, singletonSeconds: 600 });
    return id === null ? "nao" : "pedido";
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "nao foi possivel pedir a pesquisa do foco");
    return "nao";
  }
}
