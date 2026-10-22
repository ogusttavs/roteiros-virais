/**
 * E22 PR 1: cria (ou acha) o produto e o preço do plano trimestral no Stripe, de forma idempotente. A lógica mora aqui, sem I/O de rede própria, recebendo o cliente do Stripe de
 * fora, para provar com um Stripe de mentira (`stripe-preparar.test.ts`); o ponto de entrada de linha de comando é `stripe-preparar.ts`.
 *
 * A conta do Stripe é dividida com o OdontoTech (os preços de R$ 79,90 e R$ 29,90 que já existem nela são dele). Regras:
 *  - o produto tem um id fixo (`PRODUTO_ID`): achar é um `retrieve`, nunca uma busca (a busca do Stripe demora a refletir o que acabou de ser criado e duplicaria);
 *  - o preço é achado pela chave de busca (`lookup_key`), que é única na conta;
 *  - **nada que não traga `metadata.produto = roteiros` é lido como nosso, alterado ou reaproveitado**: se o produto de id fixo ou o preço da chave de busca existem sem a
 *    marca, o script para com erro e não toca em nada;
 *  - um preço nosso com valor, moeda ou período diferentes do plano também para com erro (preço do Stripe não muda; criar outro é decisão de quem lê o relatório).
 */
import { METADATA_PRODUTO, PLANO } from "../src/config/assinatura";

export const PRODUTO_ID = "roteiros_plano_trimestral";

type ProdutoLike = { id: string; metadata?: Record<string, string> | null; livemode?: boolean };
type PrecoLike = {
  id: string;
  product: string | { id: string };
  unit_amount: number | null;
  currency: string;
  active?: boolean;
  metadata?: Record<string, string> | null;
  recurring?: { interval: string; interval_count: number } | null;
  livemode?: boolean;
};

export interface StripeLike {
  products: {
    retrieve(id: string): Promise<ProdutoLike>;
    create(params: Record<string, unknown>, opcoes?: Record<string, unknown>): Promise<ProdutoLike>;
  };
  prices: {
    list(params: Record<string, unknown>): Promise<{ data: PrecoLike[] }>;
    create(params: Record<string, unknown>, opcoes?: Record<string, unknown>): Promise<PrecoLike>;
  };
}

export class ErroDePreparo extends Error {}

export type Relatorio = { produtoId: string; precoId: string; criouProduto: boolean; criouPreco: boolean };

const ehNosso = (m: Record<string, string> | null | undefined) => m?.produto === METADATA_PRODUTO.produto;

function idDoProduto(p: string | { id: string }): string {
  return typeof p === "string" ? p : p.id;
}

function ehErroDeNaoEncontrado(erro: unknown): boolean {
  const e = erro as { code?: string; statusCode?: number; type?: string } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

export async function prepararStripe(stripe: StripeLike): Promise<Relatorio> {
  // 1. O produto, pelo id fixo.
  let criouProduto = false;
  let produto: ProdutoLike | null = null;
  try {
    produto = await stripe.products.retrieve(PRODUTO_ID);
  } catch (erro) {
    if (!ehErroDeNaoEncontrado(erro)) throw erro;
  }
  if (produto) {
    if (!ehNosso(produto.metadata)) {
      throw new ErroDePreparo(`O produto ${PRODUTO_ID} ja existe na conta, mas sem metadata.produto = roteiros. Nao e nosso: nada foi alterado.`);
    }
  } else {
    produto = await stripe.products.create(
      { id: PRODUTO_ID, name: PLANO.nomeDoProduto, metadata: { ...METADATA_PRODUTO } },
      { idempotencyKey: `roteiros-produto-${PRODUTO_ID}` },
    );
    criouProduto = true;
  }

  // 2. O preço, pela chave de busca.
  const achados = await stripe.prices.list({ lookup_keys: [PLANO.lookupKey], limit: 1 });
  const existente = achados.data[0];
  if (existente) {
    if (!ehNosso(existente.metadata)) {
      throw new ErroDePreparo(`O preco com a chave ${PLANO.lookupKey} ja existe, mas sem metadata.produto = roteiros. Nao e nosso: nada foi alterado.`);
    }
    const diferente =
      existente.unit_amount !== PLANO.valorEmCentavos ||
      existente.currency !== PLANO.moeda ||
      existente.recurring?.interval !== PLANO.intervalo ||
      existente.recurring?.interval_count !== PLANO.intervaloQuantidade ||
      idDoProduto(existente.product) !== produto.id;
    if (diferente) {
      throw new ErroDePreparo(`O preco ${existente.id} (chave ${PLANO.lookupKey}) existe com valor, moeda, periodo ou produto diferentes do plano. Preco do Stripe nao muda: decida se arquiva este e cria outro. Nada foi alterado.`);
    }
    return { produtoId: produto.id, precoId: existente.id, criouProduto, criouPreco: false };
  }

  const preco = await stripe.prices.create(
    {
      product: produto.id,
      unit_amount: PLANO.valorEmCentavos,
      currency: PLANO.moeda,
      recurring: { interval: PLANO.intervalo, interval_count: PLANO.intervaloQuantidade },
      lookup_key: PLANO.lookupKey,
      metadata: { ...METADATA_PRODUTO },
    },
    { idempotencyKey: `roteiros-preco-${PLANO.lookupKey}` },
  );
  return { produtoId: produto.id, precoId: preco.id, criouProduto, criouPreco: true };
}
