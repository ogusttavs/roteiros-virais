/**
 * E22 PR 1, a assinatura pelo Stripe, contra o Postgres local e sem rede: a rota do webhook (assinatura conferida, idempotente, só `metadata.produto = roteiros`), o tratamento de
 * cada evento no banco, o portão, o começo da assinatura (só o dono) e a cortesia do admin. Nada chama o Stripe de verdade: a porta é a simulada (`chamadasSimuladas`) e o
 * aviso é assinado aqui mesmo, com um segredo de teste, pelo `generateTestHeaderString` do SDK.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { assinaturas, clientes, eventosStripe, membrosMarca, nichos, user } from "@/db/schema";
import { config } from "@/lib/config";
import { chamadasSimuladas, usarPortaStripe, type EventoDoStripe, type PortaStripe } from "@/lib/stripe";
import { listarContasAdmin } from "@/servicos/admin-contas";
import { trocarCortesiaDaConta } from "@/servicos/admin-trocas";
import { abrirPortalDaAssinatura, ErroAssinatura, frasesDaAssinatura, iniciarAssinatura, marcaPrecisaAssinar, tratarEventoDoStripe } from "@/servicos/assinatura";

import { resetarSchema } from "../../scripts/resetar-schema";
import { eventoDeAssinatura, eventoDeCheckout, eventoDeFatura, MARCA_DO_ODONTOTECH, SEGUNDOS } from "../fixtures/stripe-eventos";

const estado = vi.hoisted(() => ({ sessao: null as null | { user: { id: string; email: string; role: string }; verComo: null | object }, verComo: false }));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return { ...original, sessaoDoPainel: async () => estado.sessao, recusaDoVerComo: async () => (estado.verComo ? "Desligado no modo ver como." : null) };
});

const { POST } = await import("@/app/api/webhooks/stripe/route");
const { assinarAction, abrirPortalAction } = await import("@/app/(painel)/assinar/acoes");

const SEGREDO = "whsec_teste_da_suite_de_integracao";
const stripeSoParaAssinar = new Stripe("sk_test_nunca_usada_nos_testes");
const T0 = SEGUNDOS.T0;

let marcaA: number;
let marcaB: number;
let marcaSemDono: number;

function pedido(corpo: string, cabecalho?: string | null): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (cabecalho) headers.set("stripe-signature", cabecalho);
  return new NextRequest("http://localhost:3000/api/webhooks/stripe", { method: "POST", body: corpo, headers });
}

/** Corpo cru de um evento do Stripe, no formato que a rota recebe (`id`, `type`, `created`, `data.object`). */
function corpoDe(evento: EventoDoStripe): string {
  return JSON.stringify({ id: evento.id, object: "event", type: evento.type, created: evento.created, data: { object: evento.data.object } });
}
async function enviar(evento: EventoDoStripe, opcoes: { segredoDaAssinatura?: string } = {}): Promise<Response> {
  const corpo = corpoDe(evento);
  const cab = stripeSoParaAssinar.webhooks.generateTestHeaderString({ payload: corpo, secret: opcoes.segredoDaAssinatura ?? SEGREDO });
  return POST(pedido(corpo, cab));
}

async function linhas() {
  return db().select().from(assinaturas);
}
async function eventos() {
  return db().select().from(eventosStripe);
}

beforeAll(async () => {
  await resetarSchema(db());
  config.cobranca.webhookSecret = SEGREDO;
  const [nicho] = await db().insert(nichos).values({ slug: "assinatura-teste", nome: "Assinatura teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "as-dono-a", name: "Dono A", email: "as-dono-a@exemplo.teste", role: "cliente" },
    { id: "as-membro-a", name: "Membro A", email: "as-membro-a@exemplo.teste", role: "cliente" },
    { id: "as-dono-b", name: "Dono B", email: "as-dono-b@exemplo.teste", role: "cliente" },
    { id: "as-fora", name: "Fora", email: "as-fora@exemplo.teste", role: "cliente" },
    { id: "as-admin", name: "Admin", email: "as-admin@exemplo.teste", role: "admin" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "as-dono-a", nome: "[teste] Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "as-dono-b", nome: "[teste] Marca B", nichoId: nicho.id }).returning();
  const [c] = await db().insert(clientes).values({ nome: "[teste] Marca sem dono", nichoId: nicho.id }).returning();
  marcaA = a.id;
  marcaB = b.id;
  marcaSemDono = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "as-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "as-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "as-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(assinaturas);
  await db().delete(eventosStripe);
  await db().update(clientes).set({ cortesia: false });
  chamadasSimuladas.length = 0;
  usarPortaStripe();
  config.cobranca.webhookSecret = SEGREDO;
  estado.sessao = null;
  estado.verComo = false;
});

afterAll(async () => {
  await getPool().end();
});

describe("o webhook: a assinatura do aviso", () => {
  it("sem STRIPE_WEBHOOK_SECRET configurado responde 503 e nao trata nada (falha fechada)", async () => {
    config.cobranca.webhookSecret = "";
    const r = await enviar(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA }));
    expect(r.status).toBe(503);
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
  });

  it("assinatura que nao bate (segredo errado) responde 400 e nao grava nada", async () => {
    const r = await enviar(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA }), { segredoDaAssinatura: "whsec_de_outra_conta" });
    expect(r.status).toBe(400);
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
  });

  it("sem o cabecalho stripe-signature responde 400", async () => {
    const corpo = corpoDe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA }));
    const r = await POST(pedido(corpo, null));
    expect(r.status).toBe(400);
    expect(await linhas()).toHaveLength(0);
  });

  it("corpo adulterado depois de assinado responde 400", async () => {
    const evento = eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA });
    const corpo = corpoDe(evento);
    const cab = stripeSoParaAssinar.webhooks.generateTestHeaderString({ payload: corpo, secret: SEGREDO });
    const r = await POST(pedido(corpo.replace(`"cliente_id":"${marcaA}"`, `"cliente_id":"${marcaB}"`), cab));
    expect(r.status).toBe(400);
    expect(await linhas()).toHaveLength(0);
  });

  it("aviso certo responde 200 e cria a assinatura da marca, com o periodo e o preco", async () => {
    const r = await enviar(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_a", clienteStripeId: "cus_a", precoId: "price_a", inicio: T0, fim: T0 + 90 * SEGUNDOS.DIA }));
    expect(r.status).toBe(200);
    const [l] = await linhas();
    expect(l).toMatchObject({ clienteId: marcaA, status: "active", stripeAssinaturaId: "sub_a", stripeClienteId: "cus_a", stripePrecoId: "price_a", cancelaNoFimDoPeriodo: false });
    expect(l.periodoFim?.getTime()).toBe((T0 + 90 * SEGUNDOS.DIA) * 1000);
    expect(await eventos()).toHaveLength(1);
  });
});

describe("o webhook: idempotencia", () => {
  it("o mesmo evento reenviado nao e tratado de novo (nem que o estado tenha mudado no meio)", async () => {
    const evento = eventoDeAssinatura("customer.subscription.updated", { id: "evt_repetido", clienteId: marcaA, assinaturaId: "sub_rep", status: "active" });
    expect((await enviar(evento)).status).toBe(200);
    // Alguem (a cobranca, um admin) muda a linha depois; o reenvio do MESMO evento nao pode desfazer.
    await db().update(assinaturas).set({ status: "canceled" }).where(eq(assinaturas.stripeAssinaturaId, "sub_rep"));
    expect((await enviar(evento)).status).toBe(200);
    expect((await enviar(evento)).status).toBe(200);
    const [l] = await linhas();
    expect(l.status).toBe("canceled");
    expect(await linhas()).toHaveLength(1);
    expect(await eventos()).toHaveLength(1);
  });

  it("dois eventos diferentes da mesma assinatura nao duplicam a linha", async () => {
    await enviar(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_dup", criadoEm: T0 }));
    await enviar(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_dup", criadoEm: T0 + 5 }));
    expect(await linhas()).toHaveLength(1);
    expect(await eventos()).toHaveLength(2);
  });

  it("dois avisos iguais ao mesmo tempo tratam uma vez so", async () => {
    const evento = eventoDeAssinatura("customer.subscription.created", { id: "evt_corrida", clienteId: marcaA, assinaturaId: "sub_corrida" });
    const respostas = await Promise.all([enviar(evento), enviar(evento), enviar(evento)]);
    expect(respostas.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await linhas()).toHaveLength(1);
    expect(await eventos()).toHaveLength(1);
  });

  it("se o tratamento falha, o id do evento NAO fica gravado: responde 500 e o reenvio trata", async () => {
    const quebrado = eventoDeAssinatura("customer.subscription.created", { id: "evt_falha", clienteId: marcaA, assinaturaId: "sub_falha", fim: 1e20 });
    expect((await enviar(quebrado)).status).toBe(500);
    expect(await eventos()).toHaveLength(0);
    expect(await linhas()).toHaveLength(0);
    const consertado = eventoDeAssinatura("customer.subscription.created", { id: "evt_falha", clienteId: marcaA, assinaturaId: "sub_falha" });
    expect((await enviar(consertado)).status).toBe(200);
    expect(await linhas()).toHaveLength(1);
    expect(await eventos()).toHaveLength(1);
  });
});

describe("a conta dividida com o OdontoTech: so metadata.produto = roteiros", () => {
  it("evento de assinatura do OdontoTech responde 200 e nao deixa rastro nenhum", async () => {
    for (const tipo of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"] as const) {
      const r = await enviar(eventoDeAssinatura(tipo, { clienteId: marcaA, metadata: { ...MARCA_DO_ODONTOTECH, cliente_id: String(marcaA) }, assinaturaId: `sub_odonto_${tipo}` }));
      expect(r.status).toBe(200);
    }
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
  });

  it("evento sem metadata nenhum tambem e ignorado, mesmo trazendo um cliente_id que existe", async () => {
    const r = await enviar(eventoDeAssinatura("customer.subscription.created", { metadata: {}, assinaturaId: "sub_sem_marca" }));
    expect(r.status).toBe(200);
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
  });

  it("checkout do OdontoTech (sem a nossa marca) e ignorado", async () => {
    const r = await enviar(eventoDeCheckout({ clienteId: marcaA, metadata: { ...MARCA_DO_ODONTOTECH }, assinaturaId: "sub_odonto_co" }));
    expect(r.status).toBe(200);
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
  });

  it("fatura de assinatura que nao e nossa e nao esta no banco e ignorada", async () => {
    for (const tipo of ["invoice.paid", "invoice.payment_failed"] as const) {
      const r = await enviar(eventoDeFatura(tipo, { metadata: { ...MARCA_DO_ODONTOTECH }, assinaturaId: "sub_odonto_fatura" }));
      expect(r.status).toBe(200);
    }
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
  });

  it("fatura sem metadata de uma assinatura que e NOSSA (ja no banco) e tratada", async () => {
    await enviar(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_nossa", criadoEm: T0 }));
    const r = await enviar(eventoDeFatura("invoice.payment_failed", { metadata: {}, assinaturaId: "sub_nossa", criadoEm: T0 + 100 }));
    expect(r.status).toBe(200);
    expect((await linhas())[0].status).toBe("past_due");
  });

  it("um evento com o metadata nosso de uma marca que nao existe nao cria linha, mas fica registrado (e nosso, e nao ha o que refazer)", async () => {
    const r = await enviar(eventoDeAssinatura("customer.subscription.created", { clienteId: 987654, assinaturaId: "sub_marca_fantasma" }));
    expect(r.status).toBe(200);
    expect(await linhas()).toHaveLength(0);
    expect(await eventos()).toHaveLength(1);
  });
});

describe("o tratamento de cada evento", () => {
  it("checkout concluido e pago cria a assinatura como active, ligada a marca do client_reference_id", async () => {
    expect(await tratarEventoDoStripe(eventoDeCheckout({ clienteId: marcaA, assinaturaId: "sub_co", clienteStripeId: "cus_co" }))).toBe("tratado");
    expect((await linhas())[0]).toMatchObject({ clienteId: marcaA, status: "active", stripeClienteId: "cus_co", stripeAssinaturaId: "sub_co" });
  });

  it("checkout que chega depois da assinatura nao refaz o status", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_ordem", status: "past_due", criadoEm: T0 + 10 }));
    await tratarEventoDoStripe(eventoDeCheckout({ clienteId: marcaA, assinaturaId: "sub_ordem", pagamento: "paid", criadoEm: T0 + 20 }));
    expect((await linhas())[0].status).toBe("past_due");
  });

  it("evento mais velho nao desfaz o mais novo (fora de ordem)", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_ord", status: "canceled", criadoEm: T0 + 100 }));
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_ord", status: "active", criadoEm: T0 + 50 }));
    expect((await linhas())[0].status).toBe("canceled");
    // O evento do mesmo instante ou mais novo vale.
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_ord", status: "active", criadoEm: T0 + 100 }));
    expect((await linhas())[0].status).toBe("active");
  });

  it("fatura que falhou muda o status para past_due e a marca continua com acesso (o Stripe ainda tenta)", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_pd", criadoEm: T0 }));
    await tratarEventoDoStripe(eventoDeFatura("invoice.payment_failed", { clienteId: marcaA, assinaturaId: "sub_pd", criadoEm: T0 + 7 * SEGUNDOS.DIA }));
    expect((await linhas())[0].status).toBe("past_due");
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, new Date((T0 + 8 * SEGUNDOS.DIA) * 1000), true)).toBe(false);
  });

  it("fatura paga volta para active e leva o periodo novo", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_pago", status: "past_due", criadoEm: T0 }));
    await tratarEventoDoStripe(eventoDeFatura("invoice.paid", { clienteId: marcaA, assinaturaId: "sub_pago", criadoEm: T0 + 60, inicio: T0 + 100, fim: T0 + 100 + 90 * SEGUNDOS.DIA }));
    const [l] = await linhas();
    expect(l.status).toBe("active");
    expect(l.periodoFim?.getTime()).toBe((T0 + 100 + 90 * SEGUNDOS.DIA) * 1000);
  });

  it("fatura que falha para uma assinatura que ainda nao existe nao abre o acesso (nasce incomplete)", async () => {
    await tratarEventoDoStripe(eventoDeFatura("invoice.payment_failed", { clienteId: marcaA, assinaturaId: "sub_nova_falha" }));
    expect((await linhas())[0].status).toBe("incomplete");
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, new Date(), true)).toBe(true);
  });

  it("assinatura cancelada fecha o acesso; cancelar no fim do periodo ainda deixa entrar ate la", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marcaA, assinaturaId: "sub_cx", cancelaNoFim: true, criadoEm: T0, fim: T0 + 30 * SEGUNDOS.DIA }));
    expect((await linhas())[0].cancelaNoFimDoPeriodo).toBe(true);
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, new Date((T0 + SEGUNDOS.DIA) * 1000), true)).toBe(false);
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marcaA, assinaturaId: "sub_cx", status: "canceled", criadoEm: T0 + 30 * SEGUNDOS.DIA }));
    expect((await linhas())[0].status).toBe("canceled");
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, new Date((T0 + 31 * SEGUNDOS.DIA) * 1000), true)).toBe(true);
  });
});

describe("o portao", () => {
  const agora = new Date((T0 + SEGUNDOS.DIA) * 1000);
  it("desligado, nenhuma marca precisa assinar (e o banco nem e consultado)", async () => {
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, agora, false)).toBe(false);
  });
  it("ligado, marca sem assinatura e sem cortesia precisa", async () => {
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, agora, true)).toBe(true);
  });
  it("ligado, a cortesia dispensa", async () => {
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: true }, agora, true)).toBe(false);
  });
  it("a assinatura de uma marca nao libera a outra", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_so_a", criadoEm: T0 }));
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false }, agora, true)).toBe(false);
    expect(await marcaPrecisaAssinar({ id: marcaB, cortesia: false }, agora, true)).toBe(true);
  });
  it("por padrao (nos testes o COBRANCA_ATIVA nao esta ligado) o portao esta desligado", async () => {
    expect(config.cobranca.ativa).toBe(false);
    expect(await marcaPrecisaAssinar({ id: marcaA, cortesia: false })).toBe(false);
  });
});

describe("comecar a assinar e o portal", () => {
  const dono = { id: "as-dono-a", email: "as-dono-a@exemplo.teste" };

  it("o dono recebe o endereco do pagamento; o pedido leva a marca, o e-mail e as duas voltas", async () => {
    const r = await iniciarAssinatura(dono, { id: marcaA });
    expect(r.url).toContain("/assinar?simulado=checkout");
    const checkout = chamadasSimuladas.find((c) => c.metodo === "criarCheckout")!.pedido as Record<string, unknown>;
    expect(checkout).toMatchObject({ clienteId: marcaA, email: dono.email, precoId: "price_simulado", stripeClienteId: null });
    expect(String(checkout.urlDeSucesso)).toMatch(/\/hoje\?assinou=1$/);
    expect(String(checkout.urlDeCancelar)).toMatch(/\/assinar$/);
    expect(chamadasSimuladas.find((c) => c.metodo === "precoDoPlano")?.pedido).toBe("roteiros_trimestral");
  });

  it("quem e so membro da marca nao assina; quem nao e da marca nao assina; marca sem dono ninguem assina", async () => {
    for (const quem of [{ id: "as-membro-a", email: "x@x.x" }, { id: "as-fora", email: "y@y.y" }, { id: "as-dono-b", email: "z@z.z" }]) {
      await expect(iniciarAssinatura(quem, { id: marcaA })).rejects.toThrow(frasesDaAssinatura.soODono);
    }
    await expect(iniciarAssinatura(dono, { id: marcaSemDono })).rejects.toBeInstanceOf(ErroAssinatura);
    expect(chamadasSimuladas.filter((c) => c.metodo === "criarCheckout")).toHaveLength(0);
  });

  it("marca que ja tem assinatura que vale nao assina de novo", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_ja", criadoEm: Math.floor(Date.now() / 1000), inicio: Math.floor(Date.now() / 1000), fim: Math.floor(Date.now() / 1000) + 90 * SEGUNDOS.DIA }));
    await expect(iniciarAssinatura(dono, { id: marcaA })).rejects.toThrow(frasesDaAssinatura.jaAssinada);
  });

  it("depois de cancelar, assina de novo reaproveitando o cliente do Stripe", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marcaA, assinaturaId: "sub_velha", clienteStripeId: "cus_velho", criadoEm: T0 }));
    await iniciarAssinatura(dono, { id: marcaA });
    const checkout = chamadasSimuladas.find((c) => c.metodo === "criarCheckout")!.pedido as Record<string, unknown>;
    expect(checkout.stripeClienteId).toBe("cus_velho");
  });

  it("preco nao encontrado no Stripe: frase para a pessoa, nenhum checkout criado", async () => {
    const porta: PortaStripe = { precoDoPlano: async () => null, criarCheckout: vi.fn(), criarPortal: vi.fn() };
    usarPortaStripe(porta);
    await expect(iniciarAssinatura(dono, { id: marcaA })).rejects.toThrow(frasesDaAssinatura.semPlano);
    expect(porta.criarCheckout).not.toHaveBeenCalled();
  });

  it("erro do Stripe vira a frase de 'tente de novo', sem vazar a mensagem tecnica", async () => {
    const porta: PortaStripe = {
      precoDoPlano: async () => ({ id: "price_x" }),
      criarCheckout: async () => {
        throw new Error("Invalid API Key provided: rk_test_vazou_aqui");
      },
      criarPortal: vi.fn(),
    };
    usarPortaStripe(porta);
    const erro = await iniciarAssinatura(dono, { id: marcaA }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroAssinatura);
    expect(erro.message).toBe(frasesDaAssinatura.falhou);
    expect(erro.message).not.toContain("rk_test");
  });

  it("portal: sem assinatura nenhuma recusa; com uma, abre pelo cliente do Stripe da marca; membro nao abre", async () => {
    await expect(abrirPortalDaAssinatura({ id: dono.id }, { id: marcaA })).rejects.toThrow(frasesDaAssinatura.semAssinatura);
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_p", clienteStripeId: "cus_p" }));
    const r = await abrirPortalDaAssinatura({ id: dono.id }, { id: marcaA });
    expect(r.url).toContain("simulado=portal");
    expect((chamadasSimuladas.find((c) => c.metodo === "criarPortal")!.pedido as Record<string, unknown>).stripeClienteId).toBe("cus_p");
    await expect(abrirPortalDaAssinatura({ id: "as-membro-a" }, { id: marcaA })).rejects.toThrow(frasesDaAssinatura.soODono);
  });
});

describe("as Server Actions: a marca vem da sessao e o 'ver como' nunca assina", () => {
  function sessaoDe(id: string, email: string) {
    return { user: { id, email, role: "cliente" }, verComo: null };
  }

  it("o dono assina pela acao, e o endereco volta", async () => {
    estado.sessao = sessaoDe("as-dono-a", "as-dono-a@exemplo.teste");
    const r = await assinarAction();
    expect(r.ok).toBe(true);
    expect(chamadasSimuladas.some((c) => c.metodo === "criarCheckout")).toBe(true);
  });

  it("no 'ver como' a acao recusa antes de falar com o Stripe", async () => {
    estado.sessao = sessaoDe("as-dono-a", "as-dono-a@exemplo.teste");
    estado.verComo = true;
    const r = await assinarAction();
    expect(r.ok).toBe(false);
    const p = await abrirPortalAction();
    expect(p.ok).toBe(false);
    expect(chamadasSimuladas).toHaveLength(0);
  });

  it("membro que nao e dono recebe a frase, nao um erro de servidor", async () => {
    estado.sessao = sessaoDe("as-membro-a", "as-membro-a@exemplo.teste");
    const r = await assinarAction();
    expect(r).toEqual({ ok: false, erro: frasesDaAssinatura.soODono });
  });

  it("sem sessao nao assina", async () => {
    estado.sessao = null;
    const r = await assinarAction();
    expect(r.ok).toBe(false);
    expect(chamadasSimuladas).toHaveLength(0);
  });
});

describe("a cortesia e o estado da assinatura no admin", () => {
  it("o admin liga e desliga a cortesia e a troca fica no registro", async () => {
    await trocarCortesiaDaConta(marcaA, true, "as-admin");
    const [a] = await db().select().from(clientes).where(eq(clientes.id, marcaA));
    expect(a.cortesia).toBe(true);
    await trocarCortesiaDaConta(marcaA, false, "as-admin");
    const [a2] = await db().select().from(clientes).where(eq(clientes.id, marcaA));
    expect(a2.cortesia).toBe(false);
    const { alteracoesDaConta } = await import("@/servicos/admin-contas");
    const registro = await alteracoesDaConta(marcaA, 5);
    expect(registro.filter((x) => x.campo === "cortesia").map((x) => [x.antes, x.depois])).toEqual([["sim", "não"], ["não", "sim"]]);
  });

  it("a lista de Contas traz a cortesia e o estado da assinatura de cada marca", async () => {
    await trocarCortesiaDaConta(marcaB, true, "as-admin");
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaA, assinaturaId: "sub_lista", status: "past_due" }));
    const lista = await listarContasAdmin();
    const a = lista.find((c) => c.id === marcaA)!;
    const b = lista.find((c) => c.id === marcaB)!;
    const semDono = lista.find((c) => c.id === marcaSemDono)!;
    expect(a.cobranca).toMatchObject({ cortesia: false, assinatura: { status: "past_due" } });
    expect(b.cobranca).toEqual({ cortesia: true, assinatura: null });
    expect(semDono.cobranca).toEqual({ cortesia: false, assinatura: null });
  });

  it("marca que nao existe: a troca de cortesia recusa", async () => {
    await expect(trocarCortesiaDaConta(987654, true, "as-admin")).rejects.toThrow(/nao encontrada/);
  });
});
