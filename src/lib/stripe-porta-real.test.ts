/**
 * E22 PR 2: a porta de verdade sobre um SDK de mentira (sem rede). Prova as regras da conta dividida com o OdontoTech: o portal só abre com a configuração PRÓPRIA do Roteiros (item 0c),
 * só se reaproveita um Checkout aberto, nosso e da mesma marca (item 0b), e o cancelamento antes de apagar a marca só dá por feito o que o Stripe confirmou (item 0d).
 */
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { criarPortaComSdk, criarPortaSimulada, fecharSessaoSimulada, limparSessoesSimuladas } from "./stripe";

type Chamada = { metodo: string; args: unknown[] };

function sdkDeMentira(estado: {
  portais?: Array<{ id: string; metadata?: Record<string, string> }>;
  sessoes?: Record<string, Record<string, unknown>>;
  erroAoCancelar?: { code?: string };
  /** O que a busca de assinaturas do Stripe devolve. */
  assinaturasAchadas?: unknown[];
}) {
  const chamadas: Chamada[] = [];
  const registrar = (metodo: string, ...args: unknown[]) => chamadas.push({ metodo, args });
  const sdk = {
    billingPortal: {
      configurations: {
        async list(...args: unknown[]) {
          registrar("portal.configurations.list", ...args);
          return { data: estado.portais ?? [] };
        },
      },
      sessions: {
        async create(...args: unknown[]) {
          registrar("portal.sessions.create", ...args);
          return { url: "https://portal.exemplo.teste/sessao" };
        },
      },
    },
    checkout: {
      sessions: {
        async retrieve(id: string) {
          registrar("checkout.sessions.retrieve", id);
          const s = estado.sessoes?.[id];
          if (!s) throw Object.assign(new Error("No such checkout session"), { code: "resource_missing" });
          return s;
        },
        async expire(id: string) {
          registrar("checkout.sessions.expire", id);
          return {};
        },
        async create(...args: unknown[]) {
          registrar("checkout.sessions.create", ...args);
          return { id: "cs_nova", url: "https://checkout.exemplo.teste/nova" };
        },
      },
    },
    subscriptions: {
      async search(...args: unknown[]) {
        registrar("subscriptions.search", ...args);
        return { data: estado.assinaturasAchadas ?? [] };
      },
      async cancel(id: string) {
        registrar("subscriptions.cancel", id);
        if (estado.erroAoCancelar) throw Object.assign(new Error("erro"), estado.erroAoCancelar);
        return {};
      },
    },
  };
  return { sdk: sdk as unknown as Stripe, chamadas };
}

describe("a porta de verdade: o portal do cliente é próprio do Roteiros (item 0c)", () => {
  it("usa a configuração com metadata.produto = roteiros, nunca a padrão da conta", async () => {
    const { sdk, chamadas } = sdkDeMentira({ portais: [{ id: "bpc_odonto" }, { id: "bpc_odonto_2", metadata: { produto: "odontotech" } }, { id: "bpc_nossa", metadata: { produto: "roteiros" } }] });
    const r = await criarPortaComSdk(sdk).criarPortal({ stripeClienteId: "cus_1", urlDeVolta: "https://app.exemplo.teste/conta" });
    expect(r.url).toBe("https://portal.exemplo.teste/sessao");
    const criar = chamadas.find((c) => c.metodo === "portal.sessions.create")!;
    expect(criar.args[0]).toMatchObject({ customer: "cus_1", configuration: "bpc_nossa", return_url: "https://app.exemplo.teste/conta" });
  });

  it("sem a nossa configuração, falha e NÃO abre o portal com a padrão da conta (que é do OdontoTech)", async () => {
    const { sdk, chamadas } = sdkDeMentira({ portais: [{ id: "bpc_odonto" }, { id: "bpc_odonto_2", metadata: { produto: "odontotech" } }] });
    await expect(criarPortaComSdk(sdk).criarPortal({ stripeClienteId: "cus_1", urlDeVolta: "https://app.exemplo.teste/conta" })).rejects.toThrow(/stripe:preparar/);
    expect(chamadas.some((c) => c.metodo === "portal.sessions.create")).toBe(false);
  });
});

describe("a porta de verdade: sessão de Checkout aberta (item 0b)", () => {
  const aberta = { id: "cs_1", status: "open", url: "https://checkout.exemplo.teste/cs_1", client_reference_id: "7", metadata: { produto: "roteiros", cliente_id: "7" } };

  it("devolve o endereço da sessão nossa, aberta e da mesma marca", async () => {
    const { sdk } = sdkDeMentira({ sessoes: { cs_1: aberta } });
    expect(await criarPortaComSdk(sdk).sessaoAberta("cs_1", 7)).toEqual({ url: "https://checkout.exemplo.teste/cs_1" });
  });

  it("não devolve sessão paga, expirada, sem endereço, de outra marca, sem a nossa marca, ou que já não existe", async () => {
    const { sdk } = sdkDeMentira({
      sessoes: {
        cs_paga: { ...aberta, id: "cs_paga", status: "complete" },
        cs_exp: { ...aberta, id: "cs_exp", status: "expired" },
        cs_sem_url: { ...aberta, id: "cs_sem_url", url: null },
        cs_alheia: { ...aberta, id: "cs_alheia", client_reference_id: "8" },
        cs_odonto: { ...aberta, id: "cs_odonto", metadata: { produto: "odontotech" } },
      },
    });
    const porta = criarPortaComSdk(sdk);
    for (const id of ["cs_paga", "cs_exp", "cs_sem_url", "cs_alheia", "cs_odonto", "cs_inexistente"]) {
      expect(await porta.sessaoAberta(id, 7), id).toBeNull();
    }
  });

  it("criarCheckout devolve também o id da sessão, para a marca guardar", async () => {
    const { sdk } = sdkDeMentira({});
    const r = await criarPortaComSdk(sdk).criarCheckout({ precoId: "price_1", clienteId: 7, stripeClienteId: null, email: "a@b.c", urlDeSucesso: "x", urlDeCancelar: "y" });
    expect(r).toEqual({ url: "https://checkout.exemplo.teste/nova", sessaoId: "cs_nova" });
  });
});

describe("a porta de verdade: cancelar e fechar antes de apagar a marca (item 0d)", () => {
  const aberta = { id: "cs_1", status: "open", url: "u", client_reference_id: "7", metadata: { produto: "roteiros" } };

  it("cancelarAssinatura cancela agora; assinatura que já não existe no Stripe conta como cancelada", async () => {
    const a = sdkDeMentira({});
    await criarPortaComSdk(a.sdk).cancelarAssinatura("sub_1");
    expect(a.chamadas.map((c) => c.metodo)).toEqual(["subscriptions.cancel"]);
    const b = sdkDeMentira({ erroAoCancelar: { code: "resource_missing" } });
    await expect(criarPortaComSdk(b.sdk).cancelarAssinatura("sub_1")).resolves.toBeUndefined();
  });

  it("cancelarAssinatura propaga qualquer outro erro do Stripe (a marca não pode ser apagada)", async () => {
    const { sdk } = sdkDeMentira({ erroAoCancelar: { code: "api_connection_error" } });
    await expect(criarPortaComSdk(sdk).cancelarAssinatura("sub_1")).rejects.toThrow();
  });

  it("expirarSessao fecha a aberta; a já paga tem a assinatura cancelada; a de outro produto não é tocada; a que sumiu passa", async () => {
    const f = sdkDeMentira({
      sessoes: {
        cs_1: aberta,
        cs_paga: { ...aberta, id: "cs_paga", status: "complete", subscription: "sub_paga" },
        cs_odonto: { ...aberta, id: "cs_odonto", metadata: { produto: "odontotech" } },
      },
    });
    const porta = criarPortaComSdk(f.sdk);
    await porta.expirarSessao("cs_1");
    await porta.expirarSessao("cs_paga");
    await porta.expirarSessao("cs_odonto");
    await porta.expirarSessao("cs_sumida");
    expect(f.chamadas.filter((c) => c.metodo === "checkout.sessions.expire").map((c) => c.args[0])).toEqual(["cs_1"]);
    expect(f.chamadas.filter((c) => c.metodo === "subscriptions.cancel").map((c) => c.args[0])).toEqual(["sub_paga"]);
  });
});

describe("a porta simulada: as sessões", () => {
  it("o segundo pedido reaproveita enquanto aberta; fechada, não; e de outra marca, nunca", async () => {
    limparSessoesSimuladas();
    const porta = criarPortaSimulada();
    const nova = await porta.criarCheckout({ precoId: "p", clienteId: 3, stripeClienteId: null, email: "a@b.c", urlDeSucesso: "x", urlDeCancelar: "y" });
    expect((await porta.sessaoAberta(nova.sessaoId, 3))?.url).toBe(nova.url);
    expect(await porta.sessaoAberta(nova.sessaoId, 4)).toBeNull();
    fecharSessaoSimulada(nova.sessaoId);
    expect(await porta.sessaoAberta(nova.sessaoId, 3)).toBeNull();
  });
});

describe("a porta de verdade: o teste grátis (E22)", () => {
  const pedido = { precoId: "price_1", clienteId: 7, stripeClienteId: null, email: "a@b.c", urlDeSucesso: "x", urlDeCancelar: "y" };
  const dadosDoCheckout = (chamadas: Chamada[]) => chamadas.find((c) => c.metodo === "checkout.sessions.create")!.args[0] as Record<string, unknown>;

  it("sem dias de teste, o Checkout cobra na hora (nenhum campo de teste)", async () => {
    const { sdk, chamadas } = sdkDeMentira({});
    await criarPortaComSdk(sdk).criarCheckout(pedido);
    const dados = dadosDoCheckout(chamadas);
    expect(dados.subscription_data).toEqual({ metadata: { produto: "roteiros", cliente_id: "7" } });
    expect(dados).not.toHaveProperty("payment_method_collection");
  });

  it("teste sem cartão no começo: trial_period_days, cartão só se for preciso, e a assinatura se cancela sozinha no fim do teste sem cartão", async () => {
    const { sdk, chamadas } = sdkDeMentira({});
    await criarPortaComSdk(sdk).criarCheckout({ ...pedido, diasDeTeste: 7, exigeCartao: false });
    const dados = dadosDoCheckout(chamadas);
    expect(dados.subscription_data).toEqual({
      metadata: { produto: "roteiros", cliente_id: "7" },
      trial_period_days: 7,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    expect(dados.payment_method_collection).toBe("if_required");
    expect(dados.mode).toBe("subscription");
  });

  it("teste com cartão no começo: trial_period_days e o cartão sempre pedido (sem if_required)", async () => {
    const { sdk, chamadas } = sdkDeMentira({});
    await criarPortaComSdk(sdk).criarCheckout({ ...pedido, diasDeTeste: 7, exigeCartao: true });
    const dados = dadosDoCheckout(chamadas);
    expect(dados.subscription_data).toEqual({ metadata: { produto: "roteiros", cliente_id: "7" }, trial_period_days: 7 });
    expect(dados).not.toHaveProperty("payment_method_collection");
  });

  it("jaTeveAssinatura: a busca do Stripe acha assinatura deste produto e desta marca em qualquer estado", async () => {
    const achou = sdkDeMentira({ assinaturasAchadas: [{ id: "sub_velha" }] });
    expect(await criarPortaComSdk(achou.sdk).jaTeveAssinatura({ clienteId: 7, sessaoAnteriorId: null })).toBe(true);
    const consulta = (achou.chamadas.find((c) => c.metodo === "subscriptions.search")!.args[0] as { query: string }).query;
    expect(consulta).toContain("metadata['produto']:'roteiros'");
    expect(consulta).toContain("metadata['cliente_id']:'7'");
    const nada = sdkDeMentira({});
    expect(await criarPortaComSdk(nada.sdk).jaTeveAssinatura({ clienteId: 7, sessaoAnteriorId: null })).toBe(false);
  });

  it("jaTeveAssinatura: o Checkout anterior concluído vale mesmo que a busca ainda não veja a assinatura; o aberto, o de outra marca e o que sumiu não contam", async () => {
    const base = { id: "cs", client_reference_id: "7", metadata: { produto: "roteiros" } };
    const { sdk } = sdkDeMentira({
      sessoes: {
        cs_paga: { ...base, status: "complete" },
        cs_aberta: { ...base, status: "open" },
        cs_alheia: { ...base, status: "complete", client_reference_id: "8" },
        cs_odonto: { ...base, status: "complete", metadata: { produto: "odontotech" } },
      },
    });
    const porta = criarPortaComSdk(sdk);
    expect(await porta.jaTeveAssinatura({ clienteId: 7, sessaoAnteriorId: "cs_paga" })).toBe(true);
    for (const id of ["cs_aberta", "cs_alheia", "cs_odonto", "cs_sumida"]) expect(await porta.jaTeveAssinatura({ clienteId: 7, sessaoAnteriorId: id }), id).toBe(false);
  });

  it("jaTeveAssinatura: erro do Stripe na busca sobe (não se promete o teste sem ter conferido)", async () => {
    const { sdk } = sdkDeMentira({});
    (sdk as unknown as { subscriptions: { search: () => Promise<never> } }).subscriptions.search = async () => {
      throw new Error("Stripe fora do ar");
    };
    await expect(criarPortaComSdk(sdk).jaTeveAssinatura({ clienteId: 7, sessaoAnteriorId: null })).rejects.toThrow("Stripe fora do ar");
  });
});
