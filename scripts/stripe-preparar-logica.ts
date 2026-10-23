/**
 * E22 PR 1: cria (ou acha) o produto e o preço do plano trimestral no Stripe, de forma idempotente. A lógica mora aqui, sem I/O de rede própria, recebendo o cliente do Stripe de
 * fora, para provar com um Stripe de mentira (`stripe-preparar.test.ts`); o ponto de entrada de linha de comando é `stripe-preparar.ts`.
 *
 * A conta do Stripe é dividida com o OdontoTech (os preços de R$ 79,90 e R$ 29,90 que já existem nela são dele). Regras:
 *  - o preço é achado primeiro, pela chave de busca (`lookup_key`, única na conta), só lendo: se ele já existe, nada é criado;
 *  - o produto tem um id fixo (`PRODUTO_ID`): achar é um `retrieve`, nunca uma busca (a busca do Stripe demora a refletir o que acabou de ser criado e duplicaria);
 *  - **nada que não traga `metadata.produto = roteiros` é lido como nosso, alterado ou reaproveitado**: se o produto de id fixo ou o preço da chave de busca existem sem a
 *    marca, o script para com erro e não toca em nada;
 *  - um preço nosso com valor, moeda ou período diferentes do plano também para com erro (preço do Stripe não muda; criar outro é decisão de quem lê o relatório);
 *  - **E22 PR 2, item 0c: a configuração do portal do cliente é própria do Roteiros.** A padrão da conta é do OdontoTech (e é a que o Stripe usa se nenhuma for pedida): aqui se acha
 *    (ou cria) uma configuração à parte, com `metadata.produto = roteiros`, só com o que este produto oferece (cartão, faturas, e-mail, cancelar no fim do período; sem trocar de plano,
 *    porque o plano é um só). A configuração do OdontoTech nunca é lida como nossa, alterada nem reaproveitada.
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

type ConfiguracaoDoPortalLike = { id: string; active?: boolean; metadata?: Record<string, string> | null };

export interface StripeLike {
  products: {
    retrieve(id: string): Promise<ProdutoLike>;
    create(params: Record<string, unknown>, opcoes?: Record<string, unknown>): Promise<ProdutoLike>;
  };
  prices: {
    list(params: Record<string, unknown>): Promise<{ data: PrecoLike[] }>;
    create(params: Record<string, unknown>, opcoes?: Record<string, unknown>): Promise<PrecoLike>;
  };
  billingPortal: {
    configurations: {
      list(params: Record<string, unknown>): Promise<{ data: ConfiguracaoDoPortalLike[] }>;
      create(params: Record<string, unknown>, opcoes?: Record<string, unknown>): Promise<ConfiguracaoDoPortalLike>;
    };
  };
}

export class ErroDePreparo extends Error {}

export type Relatorio = { produtoId: string; precoId: string; criouProduto: boolean; criouPreco: boolean; portalId: string; criouPortal: boolean };
type RelatorioDoPreco = Pick<Relatorio, "produtoId" | "precoId" | "criouProduto" | "criouPreco">;

const ehNosso = (m: Record<string, string> | null | undefined) => m?.produto === METADATA_PRODUTO.produto;

function idDoProduto(p: string | { id: string }): string {
  return typeof p === "string" ? p : p.id;
}

function ehErroDeNaoEncontrado(erro: unknown): boolean {
  const e = erro as { code?: string; statusCode?: number; type?: string } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

/** A configuração do portal do Roteiros: o que o portal mostra à pessoa. Sem trocar de plano (o plano é um só); cancelar vale no fim do período já pago. */
export const CONFIGURACAO_DO_PORTAL = {
  business_profile: { headline: "Sua assinatura" },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "name"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
    },
    subscription_update: { enabled: false },
  },
} as const;

export async function prepararStripe(stripe: StripeLike): Promise<Relatorio> {
  const preco = await prepararProdutoEPreco(stripe);
  const portal = await prepararPortal(stripe);
  return { ...preco, ...portal };
}

/** Acha a configuração do portal que leva a nossa marca (só entre as ativas); se não há, cria. Nunca toca nas outras. */
async function prepararPortal(stripe: StripeLike): Promise<{ portalId: string; criouPortal: boolean }> {
  const lista = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const nossa = lista.data.find((c) => ehNosso(c.metadata));
  if (nossa) return { portalId: nossa.id, criouPortal: false };
  const criada = await stripe.billingPortal.configurations.create(
    { ...CONFIGURACAO_DO_PORTAL, metadata: { ...METADATA_PRODUTO } },
    { idempotencyKey: "roteiros-portal-v1" },
  );
  return { portalId: criada.id, criouPortal: true };
}

async function prepararProdutoEPreco(stripe: StripeLike): Promise<RelatorioDoPreco> {
  // 1. O preço primeiro, só lendo: se a chave de busca já é de outro produto (ou de um preço nosso diferente do plano), para antes de criar qualquer coisa.
  const achados = await stripe.prices.list({ lookup_keys: [PLANO.lookupKey], limit: 1 });
  const existente = achados.data[0];
  if (existente) {
    if (!ehNosso(existente.metadata)) {
      throw new ErroDePreparo(`O preco com a chave ${PLANO.lookupKey} ja existe, mas sem metadata.produto = roteiros. Nao e nosso: nada foi alterado.`);
    }
    if (existente.active === false) {
      throw new ErroDePreparo(`O preco ${existente.id} (chave ${PLANO.lookupKey}) existe mas esta arquivado. O app so usa preco ativo: reative-o no Stripe ou decida criar outro. Nada foi alterado.`);
    }
    const diferente =
      existente.unit_amount !== PLANO.valorEmCentavos ||
      existente.currency !== PLANO.moeda ||
      existente.recurring?.interval !== PLANO.intervalo ||
      existente.recurring?.interval_count !== PLANO.intervaloQuantidade ||
      idDoProduto(existente.product) !== PRODUTO_ID;
    if (diferente) {
      throw new ErroDePreparo(`O preco ${existente.id} (chave ${PLANO.lookupKey}) existe com valor, moeda, periodo ou produto diferentes do plano. Preco do Stripe nao muda: decida se arquiva este e cria outro. Nada foi alterado.`);
    }
    return { produtoId: PRODUTO_ID, precoId: existente.id, criouProduto: false, criouPreco: false };
  }

  // 2. O produto, pelo id fixo (retrieve, nunca busca: a busca do Stripe demora a refletir o que acabou de ser criado).
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

  // 3. O preço.
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
