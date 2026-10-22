/**
 * E22 PR 1: a porta do Stripe. A conferencia do aviso (assinatura HMAC) roda de verdade e sem rede; a porta simulada guarda as chamadas; a porta real recusa existir dentro do
 * Vitest (nenhum teste chama o Stripe de verdade, nem com a chave de teste no `.env`).
 */
import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";

import { chamadasSimuladas, conferirAviso, criarPortaReal, criarPortaSimulada, ErroAssinaturaDoAviso, ErroStripe, portaStripe, usarPortaStripe } from "./stripe";

const SEGREDO = "whsec_teste_nao_e_um_segredo_de_verdade";
const stripeSoParaAssinar = new Stripe("sk_test_nunca_usada_nos_testes");

function corpoDoEvento(id = "evt_1"): string {
  return JSON.stringify({ id, object: "event", type: "customer.subscription.updated", created: 1_790_000_000, data: { object: { id: "sub_1", object: "subscription", metadata: { produto: "roteiros" } } } });
}
function assinado(corpo: string, segredo = SEGREDO, quando?: number): string {
  return stripeSoParaAssinar.webhooks.generateTestHeaderString({ payload: corpo, secret: segredo, ...(quando ? { timestamp: quando } : {}) });
}

afterEach(() => {
  usarPortaStripe();
  chamadasSimuladas.length = 0;
});

describe("conferirAviso", () => {
  it("assinatura certa devolve o evento", () => {
    const corpo = corpoDoEvento();
    const e = conferirAviso(corpo, assinado(corpo), SEGREDO);
    expect(e).toMatchObject({ id: "evt_1", type: "customer.subscription.updated", created: 1_790_000_000 });
    expect(e.data.object.id).toBe("sub_1");
  });
  it("corpo adulterado depois de assinado e recusado", () => {
    const corpo = corpoDoEvento();
    const cab = assinado(corpo);
    expect(() => conferirAviso(corpo.replace("sub_1", "sub_2"), cab, SEGREDO)).toThrow(ErroAssinaturaDoAviso);
  });
  it("assinado com outro segredo e recusado", () => {
    const corpo = corpoDoEvento();
    expect(() => conferirAviso(corpo, assinado(corpo, "whsec_outro"), SEGREDO)).toThrow(ErroAssinaturaDoAviso);
  });
  it("sem cabecalho, ou com cabecalho sem sentido, e recusado", () => {
    const corpo = corpoDoEvento();
    expect(() => conferirAviso(corpo, null, SEGREDO)).toThrow(ErroAssinaturaDoAviso);
    expect(() => conferirAviso(corpo, "", SEGREDO)).toThrow(ErroAssinaturaDoAviso);
    expect(() => conferirAviso(corpo, "lixo", SEGREDO)).toThrow(ErroAssinaturaDoAviso);
  });
  it("sem segredo configurado nunca confere (falha fechada), mesmo com assinatura 'certa' de segredo vazio", () => {
    const corpo = corpoDoEvento();
    expect(() => conferirAviso(corpo, assinado(corpo, "x"), "")).toThrow(ErroAssinaturaDoAviso);
  });
  it("aviso velho demais (fora da tolerancia de 5 minutos) e recusado, contra reenvio de captura antiga", () => {
    const corpo = corpoDoEvento();
    const faz10min = Math.floor(Date.now() / 1000) - 10 * 60;
    expect(() => conferirAviso(corpo, assinado(corpo, SEGREDO, faz10min), SEGREDO)).toThrow(ErroAssinaturaDoAviso);
  });
});

describe("a porta simulada e a escolha da porta", () => {
  it("nos testes a porta e a simulada e guarda as chamadas", async () => {
    const porta = portaStripe();
    const preco = await porta.precoDoPlano("roteiros_trimestral");
    expect(preco).toEqual({ id: "price_simulado" });
    const checkout = await porta.criarCheckout({ precoId: "price_simulado", clienteId: 3, stripeClienteId: null, email: "a@b.c", urlDeSucesso: "x", urlDeCancelar: "y" });
    expect(checkout.url).toContain("/assinar?simulado=checkout");
    expect(chamadasSimuladas.map((c) => c.metodo)).toEqual(["precoDoPlano", "criarCheckout"]);
  });
  it("usarPortaStripe troca a porta e sem argumento volta", async () => {
    const outra = criarPortaSimulada();
    usarPortaStripe(outra);
    expect(portaStripe()).toBe(outra);
    usarPortaStripe();
    expect(portaStripe()).not.toBe(outra);
  });
  it("a porta real nao existe dentro do Vitest, nem com uma chave", () => {
    expect(() => criarPortaReal("rk_test_qualquer")).toThrow(ErroStripe);
  });
});
