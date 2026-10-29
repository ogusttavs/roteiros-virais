/**
 * E47 PR 3: a decisão da edição de vídeo. Depois que a fala está transcrita (`transcrito`), o modelo forte decide o que fica (por índice de palavra), o motor de corte (`src/edicao/`)
 * calcula o plano e a legenda, o código e um modelo barato conferem, e a edição termina `verificado` (pronta para o render do PR 4) ou `para_revisao` (não segue sozinha). Sem render, sem tela.
 *
 * O caminho de uma rodada: reserva a edição (`transcrito` ou `decidido` para `decidindo`, um UPDATE condicional) -> o núcleo (`decidir-edicao-nucleo.ts`): decisão do modelo forte (ou a
 * guardada, se a rodada anterior parou depois dela), plano e legenda pelo motor, conferências de código, verificador barato -> `verificado` ou `para_revisao`. Se algo reprova, uma segunda
 * decisão com o MOTIVO; se reprovar de novo, `para_revisao` com o que foi tentado. No máximo 2 decisões do modelo forte e 2 do verificador por edição.
 *
 * Quando a IA está fora do ar (crédito, sobrecarga) a edição volta ao passo anterior e a rodada relança o erro; a limpeza de hora em hora enfileira de novo, e na terceira rodada a edição
 * falha com a frase. Nenhum texto da fala vai para `geracoes_ia` (só números): a fala é da pessoa e some com o bruto.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { TENTATIVAS_DA_DECISAO } from "@/config/edicao";
import { db } from "@/db";
import { edicoes, type Edicao } from "@/db/schema";
import { apagarArquivoDaEdicao } from "@/edicao/arquivos";
import { energiaDoBanco } from "@/edicao/guardada";
import type { PalavraFalada } from "@/edicao/tipos";
import { nomesParaGrafar } from "@/edicao/verificacao";
import { calcularCustoUsd, registrarGeracao } from "@/ia/registro";
import type { ResultadoGeracao, TarefaIA } from "@/ia/tipos";
import { logger } from "@/lib/log";
import { formatarPerfilCompilado, perfilDoCliente } from "@/servicos/briefing";
import { clientePorId } from "@/servicos/clientes";
import { roteiroPorId } from "@/servicos/roteiro";
import { fraseDaEdicao, type CodigoDaEdicao } from "@/textos/edicao";

import { decidirEVerificar, type ContextoDaEdicao } from "./decidir-edicao-nucleo";

export type DepsDaDecisao = { agora?: () => Date };

async function lerContexto(edicao: Edicao): Promise<ContextoDaEdicao | null> {
  const [roteiro, marca, perfil] = await Promise.all([roteiroPorId(edicao.roteiroId, edicao.clienteId), clientePorId(edicao.clienteId), perfilDoCliente(edicao.clienteId)]);
  if (!roteiro || !marca) return null;
  const c = roteiro.conteudo;
  const textoNaTela = (c.edicao?.textoNaTela ?? []).map((t) => t.oQue).filter(Boolean);
  const corpo = c.corpo || (c.capitulos ?? []).map((cap) => cap.pontos.join(" ")).join(" ");
  return {
    roteiro: { titulo: c.titulo, gancho: c.gancho, corpo, fechamento: c.fechamento, chamadaFinal: c.chamadaFinal, textoNaTela },
    textoDoRoteiro: [c.titulo, c.gancho, corpo, c.fechamento, c.chamadaFinal, ...textoNaTela].join(" "),
    marca: { nome: marca.nome, resumo: perfil ? formatarPerfilCompilado(perfil) : "" },
    nomes: nomesParaGrafar({ nomeDaMarca: marca.nome, cidade: marca.cidade, regiao: marca.alcance === "local" ? marca.regiao : null, concorrentes: perfil?.fatos.concorrentes }),
  };
}

/** Uma chamada ao modelo, registrada em `geracoes_ia` (só números, nunca a fala) com o custo somado na edição. Falha do registro não perde a chamada que já foi paga. */
async function chamar<T>(edicao: Edicao, tarefa: TarefaIA, versao: string, nivel: "forte" | "barato", detalhes: Record<string, unknown>, fazer: () => Promise<ResultadoGeracao<T>>): Promise<T> {
  const inicio = Date.now();
  const saida = await fazer();
  const uso = { tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, tokensCacheLeitura: saida.tokensCacheLeitura, tokensCacheEscrita: saida.tokensCacheEscrita };
  const custo = calcularCustoUsd(nivel, uso);
  try {
    await registrarGeracao({
      tarefa,
      versaoPrompt: versao,
      modelo: saida.modelo,
      nivel,
      clienteId: edicao.clienteId,
      entradas: { edicaoId: edicao.id, ...detalhes },
      saida: saida.dados as unknown as Record<string, unknown>,
      uso,
      duracaoMs: Date.now() - inicio,
    });
  } catch (erro) {
    logger.warn({ err: erro, edicaoId: edicao.id }, "edicao: nao foi possivel registrar a geracao");
  }
  await db()
    .update(edicoes)
    .set({ custoIaUsd: sql`${edicoes.custoIaUsd} + ${custo.toFixed(6)}::numeric` })
    .where(eq(edicoes.id, edicao.id));
  return saida.dados;
}

/** Falha a edição com a frase e apaga o bruto: a IA não conseguiu montar a edição em todas as rodadas. */
async function falhar(edicaoId: number, codigo: CodigoDaEdicao, agora: Date): Promise<void> {
  const [linha] = await db()
    .update(edicoes)
    .set({ estado: "falhou", motivo: fraseDaEdicao(codigo), decisao: null, resultado: null, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, "decidindo")))
    .returning({ caminhoBruto: edicoes.caminhoBruto });
  if (!linha) return;
  await apagarArquivoDaEdicao(linha.caminhoBruto);
  await db().update(edicoes).set({ caminhoBruto: null, brutoApagadoEm: agora, palavras: null, energia: null }).where(eq(edicoes.id, edicaoId));
}

/** Devolve a edição ao passo em que parou (decidido, se já tem plano guardado; senão transcrito) para a limpeza enfileirar de novo. */
async function devolver(edicaoId: number, agora: Date): Promise<void> {
  await db()
    .update(edicoes)
    .set({ estado: sql`case when ${edicoes.resultado} is not null then 'decidido' else 'transcrito' end`, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, "decidindo")));
}

export async function rodarDecidirEdicao(edicaoId: number, deps: DepsDaDecisao = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(edicaoId) || edicaoId <= 0) throw new Error("uso: npm run job -- decidir-edicao <edicaoId>");
  const agora = deps.agora ? deps.agora() : new Date();

  // Só passa quem consegue reservar: duas execuções nunca decidem a mesma edição ao mesmo tempo.
  const [edicao] = await db()
    .update(edicoes)
    .set({ estado: "decidindo", tentativasDaDecisao: sql`${edicoes.tentativasDaDecisao} + 1`, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), inArray(edicoes.estado, ["transcrito", "decidido"])))
    .returning();
  if (!edicao) {
    const [atual] = await db().select({ estado: edicoes.estado }).from(edicoes).where(eq(edicoes.id, edicaoId));
    return { edicaoId, pulou: atual?.estado ?? "inexistente" };
  }

  try {
    return await decidir(edicao, agora);
  } catch (erro) {
    // A IA fora do ar ou qualquer erro: a edição volta ao passo anterior (sem perder o plano já guardado). Na última rodada, a edição falha com a frase.
    if (edicao.tentativasDaDecisao >= TENTATIVAS_DA_DECISAO) {
      logger.warn({ edicaoId, tentativas: edicao.tentativasDaDecisao }, "edicao: a decisao nao saiu e as tentativas acabaram");
      await falhar(edicaoId, "nao-montou", agora);
    } else {
      await devolver(edicaoId, agora);
    }
    throw erro;
  }
}

async function decidir(edicao: Edicao, agora: Date): Promise<Record<string, unknown>> {
  const palavras: PalavraFalada[] | null = edicao.palavras;
  if (!palavras || palavras.length === 0 || !edicao.energia) {
    await falhar(edicao.id, "sumiu", agora);
    return { edicaoId: edicao.id, estado: "falhou", motivo: "sem-fala-guardada" };
  }
  const contexto = await lerContexto(edicao);
  if (!contexto) {
    await falhar(edicao.id, "nao-achou", agora);
    return { edicaoId: edicao.id, estado: "falhou", motivo: "sem-roteiro-ou-marca" };
  }
  const energia = energiaDoBanco(edicao.energia);

  const saida = await decidirEVerificar({
    palavras,
    energia,
    duracaoS: edicao.duracaoS === null ? energia.duracao : Number(edicao.duracaoS),
    contexto,
    // Uma rodada que parou depois da decisão e antes do verificador retoma de lá, sem pagar a decisão de novo.
    decisaoGuardada: edicao.decisao && edicao.resultado ? edicao.decisao : null,
    chamar: (tarefa, versao, nivel, detalhes, fazer) => chamar(edicao, tarefa, versao, nivel, detalhes, fazer),
    // Passou nas conferências do código: guarda a decisão e o plano (se o verificador falhar, a próxima rodada retoma daqui).
    aoPassarNoCodigo: async (decisao, resultado) => {
      await db()
        .update(edicoes)
        .set({ decisao, resultado, atualizadaEm: agora })
        .where(and(eq(edicoes.id, edicao.id), eq(edicoes.estado, "decidindo")));
    },
    agora,
  });

  if (saida.estado === "verificado") {
    await db()
      .update(edicoes)
      .set({ estado: "verificado", decisao: saida.decisao, resultado: saida.resultado, motivo: null, atualizadaEm: agora })
      .where(and(eq(edicoes.id, edicao.id), eq(edicoes.estado, "decidindo")));
    const r = saida.resultado!;
    return { edicaoId: edicao.id, estado: "verificado", decisoes: saida.decisoes, trechos: r.edl.trechos.length, blocosDeLegenda: r.legenda.blocos.length, duracaoS: r.edl.duracao };
  }
  // Reprovou nas duas decisões: a edição não segue sozinha. O que foi tentado fica guardado para a conferência (admin) e a pessoa recebe a frase.
  await db()
    .update(edicoes)
    .set({ estado: "para_revisao", motivo: fraseDaEdicao("em-revisao"), decisao: saida.decisao, resultado: saida.resultado, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicao.id), eq(edicoes.estado, "decidindo")));
  return { edicaoId: edicao.id, estado: "para_revisao", decisoes: saida.decisoes, problemas: saida.problemas.length };
}
