/**
 * Precos da API da Anthropic, em dolar por 1 milhao de tokens
 * (estrategia/referencia-sdk-anthropic.md, agosto de 2026). Mudou o preco,
 * atualiza aqui e a data; registro.ts calcula o custo a partir daqui.
 */
export const DATA_PRECOS_IA = "2026-08";

export type NivelIA = "forte" | "barato";

export type PrecoModelo = {
  /** USD por 1 milhao de tokens de entrada, sem cache. */
  entrada: number;
  /** USD por 1 milhao de tokens de saida. */
  saida: number;
};

export const PRECOS_POR_NIVEL: Record<NivelIA, PrecoModelo> = {
  forte: { entrada: 5, saida: 25 },
  barato: { entrada: 1, saida: 5 },
};

/** Leitura de cache custa cerca de 10% do preco de entrada. */
export const FATOR_CACHE_LEITURA = 0.1;

/** Gravacao de cache custa 125% do preco de entrada. */
export const FATOR_CACHE_ESCRITA = 1.25;

/** API de lote: 50% de desconto em entrada e saida. */
export const FATOR_LOTE = 0.5;

/**
 * Preco da transcricao pela Groq (etapa 8, ajuste da revisao pedido na
 * etapa 9: nao ha tabela dedicada para isso, so essa constante). Confirmado
 * em console.groq.com/docs/model/whisper-large-v3-turbo em 03/09/2026.
 */
export const DATA_PRECO_GROQ = "2026-09-03";
export const PRECO_GROQ_USD_POR_HORA = 0.04;
