/**
 * Grava toda chamada de IA em geracoes_ia, com o custo calculado pela
 * formula de estrategia/referencia-sdk-anthropic.md. Inclusive chamadas em
 * mock (custo zero) e reprovadas pelo verificador.
 */
import {
  FATOR_CACHE_ESCRITA,
  FATOR_CACHE_LEITURA,
  FATOR_LOTE,
  PRECOS_POR_NIVEL,
} from "@/config/precos-ia";
import { db } from "@/db";
import { geracoesIA, type AvaliacaoGeracao } from "@/db/schema";

import type { NivelIA, TarefaIA } from "./tipos";

export type UsoTokens = {
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
};

/**
 * custo = entrada_nao_cacheada * p_entrada
 *       + cache_creation_input_tokens * p_entrada * 1.25
 *       + cache_read_input_tokens * p_entrada * 0.10
 *       + output_tokens * p_saida
 * Em lote, tudo dividido por 2 (estrategia/referencia-sdk-anthropic.md).
 */
export function calcularCustoUsd(nivel: NivelIA, uso: UsoTokens, emLote = false): number {
  const preco = PRECOS_POR_NIVEL[nivel];

  const custo =
    (uso.tokensEntrada * preco.entrada) / 1_000_000 +
    (uso.tokensCacheEscrita * preco.entrada * FATOR_CACHE_ESCRITA) / 1_000_000 +
    (uso.tokensCacheLeitura * preco.entrada * FATOR_CACHE_LEITURA) / 1_000_000 +
    (uso.tokensSaida * preco.saida) / 1_000_000;

  return emLote ? custo * FATOR_LOTE : custo;
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
};

export async function registrarGeracao(dados: DadosRegistro): Promise<number> {
  const custoUsd = calcularCustoUsd(dados.nivel, dados.uso, dados.emLote ?? false);

  const [linha] = await db()
    .insert(geracoesIA)
    .values({
      tarefa: dados.tarefa,
      versaoPrompt: dados.versaoPrompt,
      modelo: dados.modelo,
      clienteId: dados.clienteId,
      entradas: dados.entradas,
      evidencias: dados.evidencias ?? [],
      saida: dados.saida ?? null,
      tokensEntrada: dados.uso.tokensEntrada,
      tokensSaida: dados.uso.tokensSaida,
      tokensCache: dados.uso.tokensCacheLeitura + dados.uso.tokensCacheEscrita,
      custoUsd: custoUsd.toFixed(6),
      avaliacao: dados.avaliacao,
      motivoAvaliacao: dados.motivoAvaliacao,
    })
    .returning({ id: geracoesIA.id });

  return linha.id;
}
