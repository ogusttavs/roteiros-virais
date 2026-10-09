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
/** A Groq cobra no mínimo 10 segundos de áudio por pedido (console.groq.com/docs/speech-to-text, 03/09/2026). */
export const SEGUNDOS_MINIMOS_COBRADOS_GROQ = 10;

/**
 * O que o Apify cobra por mil resultados de cada ator (a loja da Apify em 02/09/2026, `HISTORICO.md`; o do Instagram no plano gratuito). Só vale quando a API não devolve o custo da execução
 * (`usageTotalUsd`): aí o custo é estimado por este preço e marcado como "estimado". Mudou o preço, atualiza aqui e a data.
 */
export const DATA_PRECO_APIFY = "2026-09-02";
export const PRECOS_APIFY_USD_POR_MIL_RESULTADOS = { tiktok: 1.7, instagram: 2.7 } as const;
/** O preço de um ator que não é nenhum dos dois conhecidos (a média dos dois, arredondada). */
const PRECO_APIFY_PADRAO_USD_POR_MIL = 2.2;

export function precoApifyPorMilResultados(ator: string): number {
  const nome = ator.toLowerCase();
  if (nome.includes("tiktok")) return PRECOS_APIFY_USD_POR_MIL_RESULTADOS.tiktok;
  if (nome.includes("instagram")) return PRECOS_APIFY_USD_POR_MIL_RESULTADOS.instagram;
  return PRECO_APIFY_PADRAO_USD_POR_MIL;
}

/**
 * O proxy do YouTube (DataImpulse, `YTDLP_PROXY`): cobrado por gigabyte de tráfego, comprado em pacote (US$ 5 = 5 GB, não é plano mensal; achado do Fable em 09/10/2026:
 * os 5 GB acabaram em 12 dias). O custo do que o `transcrever` baixa é estimado por este preço e marcado como "estimado". Mudou o preço, atualiza aqui e a data.
 */
export const DATA_PRECO_PROXY = "2026-10-09";
export const PRECO_PROXY_USD_POR_GB = 1;

/**
 * E45 PR 3: o que custa por dia manter um setor novo sendo pesquisado (coleta, transcrição, análise e temas), em dólar, medido em 02/10/2026.
 * Aparece no admin antes de ligar um ramo alternativo a uma marca (o setor que ainda não é pesquisado passa a ser, e a conta é diária
 * enquanto ele tiver marca). Mudou a medição, atualiza aqui e a data.
 */
export const CUSTO_DIARIO_DE_SETOR_NOVO_USD = 0.6;
export const DATA_CUSTO_DE_SETOR_NOVO = "2026-10-02";
