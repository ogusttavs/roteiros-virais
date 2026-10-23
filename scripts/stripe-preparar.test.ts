/**
 * E22 PR 1: `prepararStripe` contra um Stripe de mentira em memoria: cria uma vez, achar na segunda, e NUNCA toca em produto ou preco sem `metadata.produto = roteiros` (a conta
 * e dividida com o OdontoTech).
 */
import { describe, expect, it } from "vitest";

import { PLANO } from "../src/config/assinatura";

import { CONFIGURACAO_DO_PORTAL, descritorDaFatura, ErroDePreparo, prepararStripe, PRODUTO_ID, type StripeLike } from "./stripe-preparar-logica";

type Produto = { id: string; metadata: Record<string, string>; name?: string; statement_descriptor?: string | null };
type Preco = { id: string; active?: boolean; product: string; unit_amount: number; currency: string; lookup_key: string | null; metadata: Record<string, string>; recurring: { interval: string; interval_count: number } };

type Portal = { id: string; active?: boolean; metadata: Record<string, string>; features?: unknown };

function stripeDeMentira(inicial: { produtos?: Produto[]; precos?: Preco[]; portais?: Portal[] } = {}) {
  const produtos = new Map<string, Produto>((inicial.produtos ?? []).map((p) => [p.id, p]));
  const precos: Preco[] = [...(inicial.precos ?? [])];
  const portais: Portal[] = [...(inicial.portais ?? [])];
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
        const p = { id: params.id as string, metadata: params.metadata as Record<string, string>, name: params.name as string, statement_descriptor: (params.statement_descriptor as string | undefined) ?? null };
        produtos.set(p.id, p);
        return p;
      },
      async update(id, params) {
        chamadas.push(`products.update ${id}`);
        const p = produtos.get(id);
        if (!p) throw Object.assign(new Error("No such product"), { code: "resource_missing", statusCode: 404 });
        // Como o Stripe: so troca o que veio; o resto fica.
        if ("statement_descriptor" in params) p.statement_descriptor = params.statement_descriptor as string;
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
    billingPortal: {
      configurations: {
        async list(params) {
          chamadas.push(`portal.list active=${String(params.active)}`);
          return { data: portais.filter((c) => c.active !== false || params.active !== true) };
        },
        async create(params) {
          chamadas.push("portal.create");
          const c: Portal = { id: `bpc_${portais.length + 1}`, metadata: params.metadata as Record<string, string>, features: params.features };
          portais.push(c);
          return c;
        },
      },
    },
  };
  return { stripe, produtos, precos, portais, chamadas };
}

describe("prepararStripe", () => {
  it("numa conta sem nada cria o produto e o preco, os dois com metadata.produto = roteiros", async () => {
    const f = stripeDeMentira();
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ produtoId: PRODUTO_ID, criouProduto: true, criouPreco: true });
    expect(f.produtos.get(PRODUTO_ID)?.metadata).toEqual({ produto: "roteiros" });
    expect(f.precos).toHaveLength(1);
    expect(f.precos[0]).toMatchObject({ unit_amount: 119_100, currency: "brl", lookup_key: "roteiros_trimestral", recurring: { interval: "month", interval_count: 3 }, metadata: { produto: "roteiros" } });
  });

  it("cria tambem a configuracao PROPRIA do portal, com a nossa marca, sem trocar de plano e cancelando no fim do periodo (item 0c)", async () => {
    const f = stripeDeMentira();
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r.criouPortal).toBe(true);
    expect(f.portais).toHaveLength(1);
    expect(f.portais[0].metadata).toEqual({ produto: "roteiros" });
    expect(f.portais[0].features).toEqual(CONFIGURACAO_DO_PORTAL.features);
    const f2 = CONFIGURACAO_DO_PORTAL.features;
    expect(f2.subscription_update.enabled).toBe(false);
    expect(f2.subscription_cancel.mode).toBe("at_period_end");
    expect(f2.payment_method_update.enabled).toBe(true);
  });

  it("a configuracao padrao da conta (a do OdontoTech, sem a marca) nunca e tomada por nossa: cria a nossa ao lado e nao mexe na dele", async () => {
    const f = stripeDeMentira({ portais: [{ id: "bpc_odonto", active: true, metadata: {} }, { id: "bpc_odonto2", active: true, metadata: { produto: "odontotech" } }] });
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ criouPortal: true });
    expect(r.portalId).not.toBe("bpc_odonto");
    expect(f.portais).toHaveLength(3);
    expect(f.portais.filter((c) => c.metadata.produto === "roteiros")).toHaveLength(1);
  });

  it("uma configuracao de portal nossa arquivada nao conta: cria outra", async () => {
    const f = stripeDeMentira({ portais: [{ id: "bpc_velha", active: false, metadata: { produto: "roteiros" } }] });
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r.criouPortal).toBe(true);
    expect(r.portalId).not.toBe("bpc_velha");
  });

  it("rodar duas vezes nao cria nada na segunda (idempotente) e devolve os mesmos ids", async () => {
    const f = stripeDeMentira();
    const primeira = await prepararStripe(f.stripe, "Klaki");
    f.chamadas.length = 0;
    const segunda = await prepararStripe(f.stripe, "Klaki");
    expect(segunda).toEqual({ ...primeira, criouProduto: false, criouPreco: false, criouPortal: false });
    expect(f.chamadas.some((c) => c.endsWith("create"))).toBe(false);
    expect(f.precos).toHaveLength(1);
    expect(f.produtos.size).toBe(1);
    expect(f.portais).toHaveLength(1);
  });

  it("produto com o nosso id mas sem a marca: para com erro e nao cria nada", async () => {
    const f = stripeDeMentira({ produtos: [{ id: PRODUTO_ID, metadata: { produto: "odontotech" } }] });
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toBeInstanceOf(ErroDePreparo);
    expect(f.chamadas.some((c) => c.endsWith("create"))).toBe(false);
  });

  it("preco com a nossa chave de busca mas sem a marca: para com erro e nao cria nada", async () => {
    const f = stripeDeMentira({ precos: [{ id: "price_alheio", product: "prod_x", unit_amount: 7990, currency: "brl", lookup_key: PLANO.lookupKey, metadata: {}, recurring: { interval: "month", interval_count: 1 } }] });
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toBeInstanceOf(ErroDePreparo);
    expect(f.chamadas.some((c) => c.endsWith("create"))).toBe(false);
  });

  it("preco nosso arquivado: para com erro (o app so usa preco ativo) e nao cria outro", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: PRODUTO_ID, metadata: { produto: "roteiros" } }],
      precos: [{ id: "price_arquivado", active: false, product: PRODUTO_ID, unit_amount: 119_100, currency: "brl", lookup_key: PLANO.lookupKey, metadata: { produto: "roteiros" }, recurring: { interval: "month", interval_count: 3 } }],
    });
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toThrow(/arquivado/);
    expect(f.precos).toHaveLength(1);
  });

  it("preco nosso com valor diferente do plano: para com erro e nao cria outro", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: PRODUTO_ID, metadata: { produto: "roteiros" } }],
      precos: [{ id: "price_velho", product: PRODUTO_ID, unit_amount: 39_700, currency: "brl", lookup_key: PLANO.lookupKey, metadata: { produto: "roteiros" }, recurring: { interval: "month", interval_count: 3 } }],
    });
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toThrow(/diferentes do plano/);
    expect(f.precos).toHaveLength(1);
  });

  it("nunca altera nem lista o que e do OdontoTech: so le o produto de id fixo e o preco da chave nossa", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: "prod_odonto", metadata: { produto: "odontotech" } }],
      precos: [{ id: "price_odonto", product: "prod_odonto", unit_amount: 7990, currency: "brl", lookup_key: "odontotech_mensal", metadata: { produto: "odontotech" }, recurring: { interval: "month", interval_count: 1 } }],
    });
    await prepararStripe(f.stripe, "Klaki");
    expect(f.precos.find((p) => p.id === "price_odonto")?.unit_amount).toBe(7990);
    expect(f.chamadas).toEqual([`prices.list ${JSON.stringify([PLANO.lookupKey])}`, `products.retrieve ${PRODUTO_ID}`, "products.create", "prices.create", "portal.list active=true", "portal.create"]);
  });

  it("erro do Stripe que nao e 'nao encontrado' sobe (nao vira 'crie o produto')", async () => {
    const f = stripeDeMentira();
    f.stripe.products.retrieve = async () => {
      throw Object.assign(new Error("permissao negada"), { code: "permission_error", statusCode: 403 });
    };
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toThrow(/permissao negada/);
    expect(f.produtos.size).toBe(0);
  });

  it("o produto novo nasce com o descritor da fatura vindo do APP_NAME, em maiusculas (o nome que o cartao do cliente mostra)", async () => {
    const f = stripeDeMentira();
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(f.produtos.get(PRODUTO_ID)?.statement_descriptor).toBe("KLAKI");
    expect(r).toMatchObject({ descritor: "KLAKI", criouProduto: true, atualizouDescritor: false });
    expect(f.chamadas.some((c) => c.startsWith("products.update"))).toBe(false);
  });

  it("produto nosso que ja existia SEM descritor (o caso do modo teste de hoje): e atualizado, e so ele", async () => {
    const f = stripeDeMentira({
      produtos: [
        { id: PRODUTO_ID, metadata: { produto: "roteiros" }, name: "Roteiros, plano trimestral" },
        { id: "prod_odonto", metadata: { produto: "odontotech" }, statement_descriptor: "ODONTOTECH" },
      ],
      precos: [{ id: "price_nosso", product: PRODUTO_ID, unit_amount: 119_100, currency: "brl", lookup_key: PLANO.lookupKey, metadata: { produto: "roteiros" }, recurring: { interval: "month", interval_count: 3 } }],
    });
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ criouProduto: false, criouPreco: false, atualizouDescritor: true, descritor: "KLAKI", precoId: "price_nosso" });
    expect(f.produtos.get(PRODUTO_ID)).toMatchObject({ statement_descriptor: "KLAKI", name: "Roteiros, plano trimestral", metadata: { produto: "roteiros" } });
    expect(f.produtos.get("prod_odonto")?.statement_descriptor).toBe("ODONTOTECH");
    expect(f.chamadas.filter((c) => c.startsWith("products.update"))).toEqual([`products.update ${PRODUTO_ID}`]);
    expect(f.precos).toHaveLength(1);
  });

  it("produto nosso sem preco ainda e com outro descritor: atualiza o descritor e cria o preco", async () => {
    const f = stripeDeMentira({ produtos: [{ id: PRODUTO_ID, metadata: { produto: "roteiros" }, statement_descriptor: "OUTRO NOME" }] });
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ criouProduto: false, criouPreco: true, atualizouDescritor: true });
    expect(f.produtos.get(PRODUTO_ID)?.statement_descriptor).toBe("KLAKI");
  });

  it("com o descritor ja certo nao escreve nada (idempotente, tambem no caminho do preco existente)", async () => {
    const f = stripeDeMentira();
    await prepararStripe(f.stripe, "Klaki");
    f.chamadas.length = 0;
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r.atualizouDescritor).toBe(false);
    expect(f.chamadas.some((c) => c.startsWith("products.update") || c.endsWith("create"))).toBe(false);
  });

  it("trocar o APP_NAME e rodar de novo atualiza so o descritor do produto nosso", async () => {
    const f = stripeDeMentira();
    await prepararStripe(f.stripe, "Klaki");
    const r = await prepararStripe(f.stripe, "Novo Nome");
    expect(r).toMatchObject({ descritor: "NOVO NOME", atualizouDescritor: true, criouProduto: false, criouPreco: false });
    expect(f.produtos.get(PRODUTO_ID)?.statement_descriptor).toBe("NOVO NOME");
  });

  it("produto de id fixo sem a marca: nem o descritor e tocado, mesmo com o preco da nossa chave existindo", async () => {
    const f = stripeDeMentira({
      produtos: [{ id: PRODUTO_ID, metadata: { produto: "odontotech" }, statement_descriptor: "ODONTOTECH" }],
      precos: [{ id: "price_nosso", product: PRODUTO_ID, unit_amount: 119_100, currency: "brl", lookup_key: PLANO.lookupKey, metadata: { produto: "roteiros" }, recurring: { interval: "month", interval_count: 3 } }],
    });
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toBeInstanceOf(ErroDePreparo);
    expect(f.produtos.get(PRODUTO_ID)?.statement_descriptor).toBe("ODONTOTECH");
    expect(f.chamadas.some((c) => c.startsWith("products.update"))).toBe(false);
  });

  it("nome do app que nao da descritor valido para antes de qualquer chamada ao Stripe", async () => {
    const f = stripeDeMentira();
    await expect(prepararStripe(f.stripe, "")).rejects.toBeInstanceOf(ErroDePreparo);
    await expect(prepararStripe(f.stripe, "Ab")).rejects.toThrow(/descritor/);
    expect(f.chamadas).toEqual([]);
  });
});

describe("descritorDaFatura (regra do Stripe: 5 a 22 caracteres latinos, ao menos uma letra, nenhum de < > \\ ' \" *)", () => {
  it("o nome de trabalho vira KLAKI", () => {
    expect(descritorDaFatura("Klaki")).toBe("KLAKI");
  });

  it("tira acento, poe em maiusculas e arruma os espacos", () => {
    expect(descritorDaFatura("  Éclair   Roteiros ")).toBe("ECLAIR ROTEIROS");
    expect(descritorDaFatura("Ação Máxima")).toBe("ACAO MAXIMA");
  });

  it("tira os caracteres proibidos e tudo que nao e letra, numero ou espaco", () => {
    const d = descritorDaFatura("Kla<ki> *App' \"x\" \\ 2.0!");
    expect(d).toBe("KLA KI APP X 2 0");
    expect(d).toMatch(/^[A-Z0-9 ]+$/);
    expect(d).not.toMatch(/[<>\\'"*]/);
  });

  it("corta em 22 caracteres sem deixar espaco no fim", () => {
    expect(descritorDaFatura("Roteiros Para Pequenos Negocios Brasileiros")).toBe("ROTEIROS PARA PEQUENOS");
    expect(descritorDaFatura("ABCDEFGHIJKLMNOPQRSTU V")).toBe("ABCDEFGHIJKLMNOPQRSTU");
    expect(descritorDaFatura("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toHaveLength(22);
  });

  it("nunca devolve vazio, curto demais nem sem letra: lanca erro", () => {
    for (const ruim of ["", "   ", "***", "<>", "Ab", "1234", "12345 678", null, undefined, "日本語の名前", "!!!!!!"]) {
      expect(() => descritorDaFatura(ruim), String(ruim)).toThrow(ErroDePreparo);
    }
  });

  it("aceita exatamente 5 caracteres (o minimo do Stripe) e numero junto de letras", () => {
    expect(descritorDaFatura("Klaki")).toHaveLength(5);
    expect(descritorDaFatura("Klaki 2")).toBe("KLAKI 2");
  });
});
