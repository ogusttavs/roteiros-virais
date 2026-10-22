/**
 * E22 PR 1: `prepararStripe` contra um Stripe de mentira em memoria: cria uma vez, achar na segunda, e NUNCA toca em produto ou preco sem `metadata.produto = roteiros` (a conta
 * e dividida com o OdontoTech).
 */
import { describe, expect, it } from "vitest";

import { PLANO } from "../src/config/assinatura";

import { ErroDePreparo, prepararStripe, PRODUTO_ID, type StripeLike } from "./stripe-preparar-logica";

type Produto = { id: string; metadata: Record<string, string>; name?: string };
type Preco = { id: string; active?: boolean; product: string; unit_amount: number; currency: string; lookup_key: string | null; metadata: Record<string, string>; recurring: { interval: string; interval_count: number } };

function stripeDeMentira(inicial: { produtos?: Produto[]; precos?: Preco[] } = {}) {
  const produtos = new Map<string, Produto>((inicial.produtos ?? []).map((p) => [p.id, p]));
  const precos: Preco[] = [...(inicial.precos ?? [])];
  const chamadas: string[] = [];
  const stripe: StripeLike = {
    products: {
      async retrieve(id) {
        chamadas.push(`products.retrieve ${id}`);
        const p = produtos.get(id);
        if (!p) throw Object.assign(new Error("No such product"), { code: "resource_missing", statusCode: 404 });
        return p;
      },
      async create(params) {
        chamadas.push("products.create");
        const p = { id: params.id as string, metadata: params.metadata as Record<string, string>, name: params.name as string };
        produtos.set(p.id, p);
        return p;
      },
    },
    prices: {
      async list(params) {
        chamadas.push(`prices.list ${JSON.stringify(params.lookup_keys)}`);
        return { data: precos.filter((p) => (params.lookup_keys as string[]).includes(p.lookup_key ?? "")).slice(0, 1) };
      },
      async create(params) {
        chamadas.push("prices.create");
        const p: Preco = {
          id: `price_${precos.length + 1}`,
          product: params.product as string,
          unit_amount: params.unit_amount as number,
          currency: params.currency as string,
          lookup_key: params.lookup_key as string,
          metadata: params.metadata as Record<string, string>,
          recurring: params.recurring as { interval: string; interval_count: number },
        };
        precos.push(p);
        return p;
      },
    },
  };
  return { stripe, produtos, precos, chamadas };
}

describe("prepararStripe", () => {
  it("numa conta sem nada cria o produto e o preco, os dois com metadata.produto = roteiros", async () => {
    const f = stripeDeMentira();
    const r = await prepararStripe(f.stripe);
    expect(r).toMatchObject({ produtoId: PRODUTO_ID, criouProduto: true, criouPreco: true });
    expect(f.produtos.get(PRODUTO_ID)?.metadata).toEqual({ produto: "roteiros" });
    expect(f.precos).toHaveLength(1);
    expect(f.precos[0]).toMatchObject({ unit_amount: 119_100, currency: "brl", lookup_key: "roteiros_trimestral", recurring: { interval: "month", interval_count: 3 }, metadata: { produto: "roteiros" } });
  });

  it("rodar duas vezes nao cria nada na segunda (idempotente) e devolve os mesmos ids", async () => {
    const f = stripeDeMentira();
    const primeira = await prepararStripe(f.stripe);
    f.chamadas.length = 0;
    const segunda = await prepararStripe(f.stripe);
    expect(segunda).toEqual({ ...primeira, criouProduto: false, criouPreco: false });
    expect(f.chamadas.some((c) => c.endsWith("create"))).toBe(false);
    expect(f.precos).toHaveLength(1);
    expect(f.produtos.size).toBe(1);
  });

  it("produto com o nosso id mas sem a marca: para com erro e nao cria nada", async () => {
    const f = stripeDeMentira({ produtos: [{ id: PRODUTO_ID, metadata: { produto: "odontotech" } }] });
    await expect(prepararStripe(f.stripe)).rejects.toBeInstanceOf(ErroDePreparo);
    expect(f.chamadas.some((c) => c.endsWith("create"))).toBe(false);
  });

  it("preco com a nossa chave de busca mas sem a marca: para com erro e nao cria nada", async () => {
    const f = stripeDeMentira({ precos: [{ id: "price_alheio", product: "prod_x", unit_amount: 7990, currency: "brl", lookup_key: PLANO.lookupKey, metadata: {}, recurring: { interval: "month", interval_count: 1 } }] });
    await expect(prepararStripe(f.stripe)).rejects.toBeInstanceOf(ErroDePreparo);
    expect(f.chamadas.some((c) => c.endsWith("create"))).toBe(false);
  });

  it("preco nosso arquivado: para com erro (o app so usa preco ativo) e nao cria outro", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: PRODUTO_ID, metadata: { produto: "roteiros" } }],
      precos: [{ id: "price_arquivado", active: false, product: PRODUTO_ID, unit_amount: 119_100, currency: "brl", lookup_key: PLANO.lookupKey, metadata: { produto: "roteiros" }, recurring: { interval: "month", interval_count: 3 } }],
    });
    await expect(prepararStripe(f.stripe)).rejects.toThrow(/arquivado/);
    expect(f.precos).toHaveLength(1);
  });

  it("preco nosso com valor diferente do plano: para com erro e nao cria outro", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: PRODUTO_ID, metadata: { produto: "roteiros" } }],
      precos: [{ id: "price_velho", product: PRODUTO_ID, unit_amount: 39_700, currency: "brl", lookup_key: PLANO.lookupKey, metadata: { produto: "roteiros" }, recurring: { interval: "month", interval_count: 3 } }],
    });
    await expect(prepararStripe(f.stripe)).rejects.toThrow(/diferentes do plano/);
    expect(f.precos).toHaveLength(1);
  });

  it("nunca altera nem lista o que e do OdontoTech: so le o produto de id fixo e o preco da chave nossa", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: "prod_odonto", metadata: { produto: "odontotech" } }],
      precos: [{ id: "price_odonto", product: "prod_odonto", unit_amount: 7990, currency: "brl", lookup_key: "odontotech_mensal", metadata: { produto: "odontotech" }, recurring: { interval: "month", interval_count: 1 } }],
    });
    await prepararStripe(f.stripe);
    expect(f.precos.find((p) => p.id === "price_odonto")?.unit_amount).toBe(7990);
    expect(f.chamadas).toEqual([`prices.list ${JSON.stringify([PLANO.lookupKey])}`, `products.retrieve ${PRODUTO_ID}`, "products.create", "prices.create"]);
  });

  it("erro do Stripe que nao e 'nao encontrado' sobe (nao vira 'crie o produto')", async () => {
    const f = stripeDeMentira();
    f.stripe.products.retrieve = async () => {
      throw Object.assign(new Error("permissao negada"), { code: "permission_error", statusCode: 403 });
    };
    await expect(prepararStripe(f.stripe)).rejects.toThrow(/permissao negada/);
    expect(f.produtos.size).toBe(0);
  });
});
