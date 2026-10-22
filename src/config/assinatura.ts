/**
 * E22 PR 1, a assinatura pelo Stripe: o plano único (decisão do Gustavo em 22/10/2026). Um plano só, o trimestral: R$ 1.191,00 a cada 3 meses (R$ 397 por mês), em reais,
 * sem taxa de adesão, só cartão. A conta do Stripe é a da GetOrbita, dividida com o OdontoTech: tudo que este produto cria ou lê leva `metadata.produto = roteiros`, e
 * nada sem essa marca é tocado ou tratado.
 */

/** O que marca, no produto, no preço, na sessão do Checkout e na assinatura, que a coisa é deste produto e não do OdontoTech. */
export const METADATA_PRODUTO = { produto: "roteiros" } as const;

export const PLANO = {
  lookupKey: "roteiros_trimestral",
  nomeDoProduto: "Roteiros, plano trimestral",
  /** R$ 1.191,00 em centavos. */
  valorEmCentavos: 119_100,
  moeda: "brl",
  /** A cada 3 meses. */
  intervalo: "month",
  intervaloQuantidade: 3,
} as const;

/** Depois do fim do período pago, quantos dias o acesso continua enquanto o aviso de renovação do Stripe não chega (o Stripe reenvia por até 3 dias). */
export const DIAS_DE_FOLGA_DA_RENOVACAO = 3;
