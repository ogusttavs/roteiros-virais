/**
 * Grava toda chamada de IA em geracoes_ia, com o custo calculado pela
 * formula de estrategia/referencia-sdk-anthropic.md. Inclusive chamadas em
 * mock (custo zero) e reprovadas pelo verificador.
 */
import { eq } from "drizzle-orm";

import {
  FATOR_CACHE_ESCRITA,
  FATOR_CACHE_LEITURA,
  FATOR_LOTE,
  PRECO_BUSCA_WEB_USD,
  PRECOS_POR_NIVEL,
} from "@/config/precos-ia";
import { db } from "@/db";
import { clientes, geracoesIA, nichos, videos, type AvaliacaoGeracao } from "@/db/schema";
import { contextoDaExecucao } from "@/jobs/contexto-execucao";

import type { NivelIA, TarefaIA } from "./tipos";

export type UsoTokens = {
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
  /** E54: buscas na web feitas pela ferramenta da Anthropic (`usage.server_tool_use.web_search_requests`), US$ 0,01 cada, fora do desconto do lote. */
  buscasNaWeb?: number;
};

/**
 * custo = entrada_nao_cacheada * p_entrada
 *       + cache_creation_input_tokens * p_entrada * 1.25
 *       + cache_read_input_tokens * p_entrada * 0.10
 *       + output_tokens * p_saida
 * Em lote, tudo dividido por 2 (estrategia/referencia-sdk-anthropic.md).
 * A busca na web (E54) soma `buscasNaWeb * US$ 0,01` por fora: o lote nao a descontaria.
 */
export function calcularCustoUsd(nivel: NivelIA, uso: UsoTokens, emLote = false): number {
  const preco = PRECOS_POR_NIVEL[nivel];

  const custo =
    (uso.tokensEntrada * preco.entrada) / 1_000_000 +
    (uso.tokensCacheEscrita * preco.entrada * FATOR_CACHE_ESCRITA) / 1_000_000 +
    (uso.tokensCacheLeitura * preco.entrada * FATOR_CACHE_LEITURA) / 1_000_000 +
    (uso.tokensSaida * preco.saida) / 1_000_000;

  const buscas = (uso.buscasNaWeb ?? 0) * PRECO_BUSCA_WEB_USD;
  return (emLote ? custo * FATOR_LOTE : custo) + buscas;
}

export type DadosRegistro = {
  tarefa: TarefaIA;
  versaoPrompt: string;
  modelo: string;
  nivel: NivelIA;
  /** Nulo em tarefas de nicho ou do sistema, sem cliente especifico. */
  clienteId?: number;
  entradas: Record<string, unknown>;
  evidencias?: number[];
  saida?: Record<string, unknown> | null;
  uso: UsoTokens;
  emLote?: boolean;
  avaliacao?: AvaliacaoGeracao;
  motivoAvaliacao?: string;
  /**
   * R1, item 0b: quanto levou a chamada que gerou esta linha, do pedido à resposta. Alimenta a
   * calibração futura da frase de espera (`textosComuns.esperaDuracao`) com dado real em vez de
   * estimativa; nulo quando quem registra não mediu (a maioria das tarefas, por enquanto).
   */
  duracaoMs?: number;
  /** O ramo (setor) a que o gasto pertence. Sem ele, `ramoDaGeracao` descobre pelo que a chamada já traz (veja lá). */
  ramoId?: number | null;
};

/**
 * De que ramo é esta geração (custo que falta no admin), na ordem do mais certo ao menos certo: o que quem
 * registra disse; o `nichoId` nas entradas; o ramo do vídeo analisado (`videoId` nas entradas); o ramo da
 * execução em andamento (job disparado por um ramo); o ramo da conta do cliente. Sem nenhum, fica nulo
 * (gasto que não é de um ramo só, como o das telas de lembrar a agenda).
 */
async function descobrirRamo(dados: Pick<DadosRegistro, "ramoId" | "entradas" | "clienteId">): Promise<number | null> {
  if (dados.ramoId !== undefined) return dados.ramoId;
  const doNicho = dados.entradas?.nichoId;
  if (typeof doNicho === "number") return doNicho;
  const doVideo = dados.entradas?.videoId;
  if (typeof doVideo === "number") {
    const [video] = await db().select({ nichoId: videos.nichoId }).from(videos).where(eq(videos.id, doVideo));
    if (video?.nichoId != null) return video.nichoId;
  }
  const doContexto = contextoDaExecucao()?.ramoId;
  if (doContexto != null) return doContexto;
  if (dados.clienteId !== undefined) {
    const [cliente] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, dados.clienteId));
    if (cliente?.nichoId != null) return cliente.nichoId;
  }
  return null;
}

/**
 * O ramo da geração, nunca derrubando o registro: qualquer erro da descoberta vira "sem ramo", e um ramo que não existe (um `nichoId`
 * pendurado nas entradas) também, porque a chave estrangeira recusaria a linha inteira e a geração, que não depende de ramo, ficaria sem registro.
 */
export async function ramoDaGeracao(dados: Pick<DadosRegistro, "ramoId" | "entradas" | "clienteId">): Promise<number | null> {
  try {
    const ramo = await descobrirRamo(dados);
    if (ramo === null) return null;
    const [existe] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.id, ramo));
    return existe ? ramo : null;
  } catch {
    return null;
  }
}

export async function registrarGeracao(dados: DadosRegistro): Promise<number> {
  const custoUsd = calcularCustoUsd(dados.nivel, dados.uso, dados.emLote ?? false);
  const ramoId = await ramoDaGeracao(dados);

  const [linha] = await db()
    .insert(geracoesIA)
    .values({
      tarefa: dados.tarefa,
      versaoPrompt: dados.versaoPrompt,
      modelo: dados.modelo,
      clienteId: dados.clienteId,
      ramoId,
      entradas: dados.entradas,
      evidencias: dados.evidencias ?? [],
      saida: dados.saida ?? null,
      tokensEntrada: dados.uso.tokensEntrada,
      tokensSaida: dados.uso.tokensSaida,
      tokensCache: dados.uso.tokensCacheLeitura + dados.uso.tokensCacheEscrita,
      custoUsd: custoUsd.toFixed(6),
      avaliacao: dados.avaliacao,
      motivoAvaliacao: dados.motivoAvaliacao,
      duracaoMs: dados.duracaoMs,
    })
    .returning({ id: geracoesIA.id });

  return linha.id;
}
