/**
 * Achado 5 da revisão (23/10/2026): a fatura do cartão mostra o nome do produto (APP_NAME), não o da conta. Aqui o `stripe:preparar` roda com o SDK OFICIAL do Stripe, apontado para um
 * servidor HTTP local que faz de conta que é o Stripe (nunca a rede de verdade), para provar o que de fato vai pelo fio: o `statement_descriptor` no corpo do pedido de criar o produto,
 * ou de atualizar o produto que já existia sem ele, e nenhuma escrita em produto que não é nosso.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";

import { prepararStripe, PRODUTO_ID, type StripeLike } from "../../scripts/stripe-preparar-logica";

type Pedido = { metodo: string; caminho: string; corpo: URLSearchParams };

/** Um Stripe de mentira em HTTP: responde só ao que o `stripe:preparar` pergunta, e guarda tudo que recebeu. */
async function subirStripeDeMentira(estado: { produto?: Record<string, unknown>; preco?: Record<string, unknown> }) {
  const pedidos: Pedido[] = [];
  const servidor: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const pedacos: Buffer[] = [];
    req.on("data", (p: Buffer) => pedacos.push(p));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const corpo = new URLSearchParams(Buffer.concat(pedacos).toString("utf8"));
      pedidos.push({ metodo: req.method ?? "GET", caminho: url.pathname, corpo });
      const responder = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const produtoUrl = `/v1/products/${PRODUTO_ID}`;
      if (req.method === "GET" && url.pathname === "/v1/prices") return responder(200, { object: "list", data: estado.preco ? [estado.preco] : [], has_more: false });
      if (req.method === "GET" && url.pathname === produtoUrl) {
        return estado.produto ? responder(200, estado.produto) : responder(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such product" } });
      }
      if (req.method === "POST" && url.pathname === "/v1/products") {
        estado.produto = { id: corpo.get("id"), object: "product", metadata: { produto: corpo.get("metadata[produto]") }, statement_descriptor: corpo.get("statement_descriptor") };
        return responder(200, estado.produto);
      }
      if (req.method === "POST" && url.pathname === produtoUrl) {
        estado.produto = { ...estado.produto, statement_descriptor: corpo.get("statement_descriptor") };
        return responder(200, estado.produto);
      }
      if (req.method === "POST" && url.pathname === "/v1/prices") return responder(200, { id: "price_novo", object: "price", product: PRODUTO_ID });
      if (req.method === "GET" && url.pathname === "/v1/billing_portal/configurations") return responder(200, { object: "list", data: [{ id: "bpc_nossa", metadata: { produto: "roteiros" } }], has_more: false });
      return responder(500, { error: { type: "api_error", message: `rota nao prevista: ${req.method} ${url.pathname}` } });
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = (servidor.address() as AddressInfo).port;
  const stripe = new Stripe("sk_test_chave_de_mentira", { host: "127.0.0.1", port: porta, protocol: "http", maxNetworkRetries: 0 });
  return { stripe: stripe as unknown as StripeLike, pedidos, estado, fechar: () => new Promise<void>((ok) => servidor.close(() => ok())) };
}

const precoNosso = {
  id: "price_nosso",
  object: "price",
  product: PRODUTO_ID,
  unit_amount: 119_100,
  currency: "brl",
  active: true,
  metadata: { produto: "roteiros" },
  recurring: { interval: "month", interval_count: 3 },
};

describe("stripe:preparar com o SDK oficial contra um Stripe de mentira em HTTP", () => {
  let fechar: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await fechar?.();
    fechar = null;
  });

  it("produto novo: o pedido de criar leva statement_descriptor=KLAKI e a marca; nada vai para outro produto", async () => {
    const f = await subirStripeDeMentira({});
    fechar = f.fechar;
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ criouProduto: true, descritor: "KLAKI" });
    const criar = f.pedidos.find((p) => p.metodo === "POST" && p.caminho === "/v1/products");
    expect(criar?.corpo.get("statement_descriptor")).toBe("KLAKI");
    expect(criar?.corpo.get("metadata[produto]")).toBe("roteiros");
    expect(f.pedidos.filter((p) => p.metodo === "POST" && p.caminho.startsWith("/v1/products/"))).toEqual([]);
  });

  it("produto nosso que ja existia sem descritor: um unico POST no produto de id fixo, so com statement_descriptor=KLAKI", async () => {
    const f = await subirStripeDeMentira({ produto: { id: PRODUTO_ID, object: "product", metadata: { produto: "roteiros" }, statement_descriptor: null }, preco: precoNosso });
    fechar = f.fechar;
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ criouProduto: false, criouPreco: false, atualizouDescritor: true, descritor: "KLAKI" });
    const escritas = f.pedidos.filter((p) => p.metodo === "POST" && (p.caminho === "/v1/products" || p.caminho.startsWith("/v1/products/") || p.caminho.startsWith("/v1/prices")));
    expect(escritas).toHaveLength(1);
    expect(escritas[0].caminho).toBe(`/v1/products/${PRODUTO_ID}`);
    expect([...escritas[0].corpo.keys()]).toEqual(["statement_descriptor"]);
    expect(escritas[0].corpo.get("statement_descriptor")).toBe("KLAKI");
  });

  it("rodar de novo com o descritor ja certo: nenhuma escrita no produto", async () => {
    const f = await subirStripeDeMentira({ produto: { id: PRODUTO_ID, object: "product", metadata: { produto: "roteiros" }, statement_descriptor: "KLAKI" }, preco: precoNosso });
    fechar = f.fechar;
    const r = await prepararStripe(f.stripe, "Klaki");
    expect(r).toMatchObject({ atualizouDescritor: false });
    expect(f.pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
  });

  it("produto de id fixo que nao e nosso: o script para e NADA e escrito (o descritor do OdontoTech fica como esta)", async () => {
    const f = await subirStripeDeMentira({ produto: { id: PRODUTO_ID, object: "product", metadata: { produto: "odontotech" }, statement_descriptor: "ODONTOTECH" }, preco: precoNosso });
    fechar = f.fechar;
    await expect(prepararStripe(f.stripe, "Klaki")).rejects.toThrow(/Nao e nosso/);
    expect(f.pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
    expect(f.estado.produto?.statement_descriptor).toBe("ODONTOTECH");
  });
});
