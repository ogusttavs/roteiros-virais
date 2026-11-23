/**
 * E22, o teste grátis, contra o Postgres local e sem rede: o Checkout nasce com os dias de teste só para a marca que ainda não teve assinatura (no nosso banco nem no Stripe), os avisos de um
 * cadastro com teste deixam a assinatura `trialing` com acesso (e a fatura de R$ 0 não a vira `active`), o portão deixa a marca em teste passar, e o e-mail de 2 dias antes do fim do
 * teste sai uma vez, só no horário certo e só para o dono. O Stripe é o simulado (`chamadasSimuladas`).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { assinaturas, checkoutsStripe, clientes, eventosStripe, membrosMarca, nichos, user } from "@/db/schema";
import { config } from "@/lib/config";
import { chamadasSimuladas, limparSessoesSimuladas, marcarHistoricoSimulado, usarPortaStripe } from "@/lib/stripe";
import { iniciarAssinatura, marcaPrecisaAssinar, tratarEventoDoStripe } from "@/servicos/assinatura";
import { avisarFimDoTeste, avisarTesteTerminado } from "@/servicos/assinatura-teste";

import { resetarSchema } from "../../scripts/resetar-schema";
import { eventoDeAssinatura, eventoDeCheckout, eventoDeFatura, SEGUNDOS } from "../fixtures/stripe-eventos";

const dono = { id: "tg-dono", email: "tg-dono@exemplo.teste" };
let marca: number;
let marcaSemDono: number;
let n = 0;

/** Meio-dia de Brasília (15:00 UTC). */
const AGORA = new Date("2026-11-10T15:00:00Z");
const HORA = 3600 * 1000;
const agoraS = () => Math.floor(AGORA.getTime() / 1000);

const pedidoDoCheckout = () => chamadasSimuladas.filter((c) => c.metodo === "criarCheckout").map((c) => c.pedido as Record<string, unknown>);

/** Os três avisos de um cadastro com teste, como o Stripe manda: o Checkout sem nada a pagar, a assinatura `trialing` e a fatura de R$ 0. */
async function cadastrarComTeste(clienteId: number, assinaturaId: string, fim: number, opcoes: { cancelaNoFim?: boolean } = {}) {
  const base = { clienteId, assinaturaId, clienteStripeId: `cus_${assinaturaId}`, criadoEm: agoraS() };
  await tratarEventoDoStripe(eventoDeCheckout({ ...base, pagamento: "no_payment_required" }));
  await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { ...base, status: "trialing", inicio: agoraS(), fim, cancelaNoFim: opcoes.cancelaNoFim }));
  await tratarEventoDoStripe(eventoDeFatura("invoice.paid", { ...base, inicio: agoraS(), fim, valorPago: 0 }));
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "teste-gratis", nome: "Teste grátis", termos: [] }).returning();
  await db().insert(user).values([
    { id: dono.id, name: "Dono", email: dono.email, role: "cliente" },
    { id: "tg-dono-2", name: "Dono 2", email: "tg-dono-2@exemplo.teste", role: "cliente" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: dono.id, nome: "[teste] Marca do teste", nichoId: nicho.id }).returning();
  const [c] = await db().insert(clientes).values({ nome: "[teste] Marca sem dono", nichoId: nicho.id }).returning();
  marca = a.id;
  marcaSemDono = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: dono.id, clienteId: marca, papel: "dono" },
    { usuarioId: "tg-dono-2", clienteId: marca, papel: "membro" },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(checkoutsStripe);
  limparSessoesSimuladas();
  await db().delete(assinaturas);
  await db().delete(eventosStripe);
  chamadasSimuladas.length = 0;
  usarPortaStripe();
  config.cobranca.testeDias = 7;
  config.cobranca.testeExigeCartao = false;
  n += 1;
});

afterAll(async () => {
  config.cobranca.testeDias = 7;
  config.cobranca.testeExigeCartao = false;
  await getPool().end();
});

describe("o Checkout com o teste grátis", () => {
  it("a marca que nunca assinou abre o Checkout com 7 dias de teste e sem pedir o cartão (o padrão)", async () => {
    await iniciarAssinatura(dono, { id: marca });
    expect(pedidoDoCheckout()).toHaveLength(1);
    expect(pedidoDoCheckout()[0]).toMatchObject({ clienteId: marca, diasDeTeste: 7, exigeCartao: false });
    // Conferiu no Stripe antes de prometer o teste.
    expect(chamadasSimuladas.filter((c) => c.metodo === "jaTeveAssinatura")).toHaveLength(1);
  });

  it("os dias e o cartão no começo vêm da configuração; com 0 dias, não há teste e o Checkout cobra na hora", async () => {
    config.cobranca.testeDias = 14;
    config.cobranca.testeExigeCartao = true;
    await iniciarAssinatura(dono, { id: marca });
    expect(pedidoDoCheckout()[0]).toMatchObject({ diasDeTeste: 14, exigeCartao: true });
    await db().delete(checkoutsStripe);
    limparSessoesSimuladas();
    chamadasSimuladas.length = 0;
    config.cobranca.testeDias = 0;
    await iniciarAssinatura(dono, { id: marca });
    expect(pedidoDoCheckout()[0]).toMatchObject({ diasDeTeste: 0 });
  });

  it("o teste é uma vez por marca: quem já teve assinatura cancelada (ou teste que acabou) abre o Checkout sem teste", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marca, assinaturaId: `sub_velha_${n}`, clienteStripeId: "cus_velho", criadoEm: SEGUNDOS.T0 }));
    await iniciarAssinatura(dono, { id: marca });
    expect(pedidoDoCheckout()[0]).toMatchObject({ clienteId: marca, diasDeTeste: 0 });
  });

  it("o teste é uma vez por marca também quando o nosso banco não sabe: o Stripe diz que ela já teve assinatura (aviso perdido), então sem teste", async () => {
    marcarHistoricoSimulado(marca);
    await iniciarAssinatura(dono, { id: marca });
    expect(pedidoDoCheckout()[0]).toMatchObject({ clienteId: marca, diasDeTeste: 0 });
  });

  it("o Checkout anterior da marca vai para a conferência no Stripe (se foi pago e o aviso se perdeu, vale como assinatura que existe)", async () => {
    await iniciarAssinatura(dono, { id: marca });
    const primeira = (await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, marca)))[0];
    // O Checkout acaba sem ser reaproveitado (pago ou expirado): a próxima tentativa abre outro e pergunta pelo anterior.
    const { fecharSessaoSimulada } = await import("@/lib/stripe");
    fecharSessaoSimulada(primeira.stripeSessaoId);
    chamadasSimuladas.length = 0;
    await iniciarAssinatura(dono, { id: marca });
    const pergunta = chamadasSimuladas.find((c) => c.metodo === "jaTeveAssinatura")!.pedido as Record<string, unknown>;
    expect(pergunta).toEqual({ clienteId: marca, sessaoAnteriorId: primeira.stripeSessaoId });
  });
});

describe("os avisos de um cadastro com teste", () => {
  it("assinatura trialing com acesso até o fim do teste; a fatura de R$ 0 não a vira ativa nem muda o fim", async () => {
    const fim = agoraS() + 7 * SEGUNDOS.DIA;
    await cadastrarComTeste(marca, `sub_teste_${n}`, fim);
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha).toMatchObject({ status: "trialing", cancelaNoFimDoPeriodo: false });
    expect(linha.periodoFim?.getTime()).toBe(fim * 1000);
  });

  it("a ordem dos avisos não muda o resultado: a fatura de R$ 0 e o Checkout antes da assinatura também acabam em trialing", async () => {
    const fim = agoraS() + 7 * SEGUNDOS.DIA;
    const base = { clienteId: marca, assinaturaId: `sub_ordem_${n}`, clienteStripeId: "cus_ordem", criadoEm: agoraS() };
    await tratarEventoDoStripe(eventoDeFatura("invoice.paid", { ...base, inicio: agoraS(), fim, valorPago: 0 }));
    await tratarEventoDoStripe(eventoDeCheckout({ ...base, pagamento: "no_payment_required" }));
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { ...base, status: "trialing", inicio: agoraS(), fim }));
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha.status).toBe("trialing");
    expect(linha.periodoFim?.getTime()).toBe(fim * 1000);
  });

  it("o portão deixa a marca em teste passar e a barra quando o teste passa do fim mais a folga", async () => {
    await cadastrarComTeste(marca, `sub_portao_${n}`, agoraS() + 7 * SEGUNDOS.DIA);
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, AGORA, true)).toBe(false);
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, new Date(AGORA.getTime() + 20 * 24 * HORA), true)).toBe(true);
  });

  it("no fim do teste, o Stripe cobra: a assinatura vira ativa pela atualização e pela fatura com valor, com o período novo", async () => {
    const fim = agoraS() + 7 * SEGUNDOS.DIA;
    await cadastrarComTeste(marca, `sub_cobra_${n}`, fim);
    const depois = fim + 5;
    const base = { clienteId: marca, assinaturaId: `sub_cobra_${n}`, clienteStripeId: `cus_sub_cobra_${n}`, criadoEm: depois };
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { ...base, status: "active", inicio: fim, fim: fim + 90 * SEGUNDOS.DIA }));
    await tratarEventoDoStripe(eventoDeFatura("invoice.paid", { ...base, inicio: fim, fim: fim + 90 * SEGUNDOS.DIA, valorPago: 119100 }));
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha.status).toBe("active");
    expect(linha.periodoFim?.getTime()).toBe((fim + 90 * SEGUNDOS.DIA) * 1000);
  });

  it("sem cartão no fim do teste o Stripe cancela: a assinatura vira cancelada e a marca assina de novo, agora sem teste", async () => {
    const fim = agoraS() + 7 * SEGUNDOS.DIA;
    await cadastrarComTeste(marca, `sub_sem_cartao_${n}`, fim);
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marca, assinaturaId: `sub_sem_cartao_${n}`, criadoEm: fim + 5, status: "canceled" }));
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha.status).toBe("canceled");
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, new Date((fim + 10) * 1000), true)).toBe(true);
    await iniciarAssinatura(dono, { id: marca });
    expect(pedidoDoCheckout().at(-1)).toMatchObject({ diasDeTeste: 0 });
  });
});

describe("o e-mail de 2 dias antes do fim do teste", () => {
  type Mensagem = { para: string; assunto: string; html: string };
  const enviar = () => vi.fn<(m: Mensagem) => Promise<undefined>>(async () => undefined);

  async function emTeste(fimEmHoras: number, opcoes: { cancelaNoFim?: boolean } = {}) {
    await cadastrarComTeste(marca, `sub_lembrete_${n}`, agoraS() + fimEmHoras * 3600, opcoes);
  }

  it("sai uma vez para o dono (não para o membro), com a data do fim e o convite para cadastrar o cartão, e marca a assinatura", async () => {
    await emTeste(40);
    const manda = enviar();
    const r = await avisarFimDoTeste(AGORA, manda);
    expect(r).toMatchObject({ candidatas: 1, avisadas: 1, falhas: 0, foraDoHorario: false });
    expect(manda).toHaveBeenCalledTimes(1);
    const mensagem = manda.mock.calls[0][0];
    expect(mensagem.para).toBe(dono.email);
    expect(mensagem.assunto).toBe("O seu teste grátis termina em 2 dias");
    expect(mensagem.html).toContain("[teste] Marca do teste");
    expect(mensagem.html).toContain("12 de novembro de 2026");
    expect(mensagem.html).toContain("cadastre o cartão");
    expect(mensagem.html).not.toContain("primeira cobrança");
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha.lembreteFimDoTesteEm).not.toBeNull();
    // Outra rodada, uma hora depois: já avisou, não repete.
    const outra = enviar();
    expect(await avisarFimDoTeste(new Date(AGORA.getTime() + HORA), outra)).toMatchObject({ candidatas: 0, avisadas: 0 });
    expect(outra).not.toHaveBeenCalled();
  });

  it("com o cartão pedido no começo, o e-mail fala da primeira cobrança e de como cancelar", async () => {
    config.cobranca.testeExigeCartao = true;
    await emTeste(40);
    const manda = enviar();
    await avisarFimDoTeste(AGORA, manda);
    const html = manda.mock.calls[0][0].html;
    expect(html).toContain("a primeira cobrança");
    expect(html).toContain("Gerenciar a assinatura");
  });

  it("não sai fora da janela: teste que acaba em mais de 2 dias, já acabado, ou cancelado pela pessoa", async () => {
    await emTeste(80);
    expect(await avisarFimDoTeste(AGORA, enviar())).toMatchObject({ candidatas: 0 });
    await db().delete(assinaturas);
    await emTeste(-2);
    expect(await avisarFimDoTeste(AGORA, enviar())).toMatchObject({ candidatas: 0 });
    await db().delete(assinaturas);
    await emTeste(30, { cancelaNoFim: true });
    const manda = enviar();
    expect(await avisarFimDoTeste(AGORA, manda)).toMatchObject({ candidatas: 0 });
    expect(manda).not.toHaveBeenCalled();
  });

  it("de madrugada ou à noite não manda nada (só entre 8h e 20h de Brasília) e a assinatura continua sem marca para a próxima rodada", async () => {
    await emTeste(40);
    const manda = enviar();
    const madrugada = new Date("2026-11-10T07:00:00Z"); // 04:00 em Brasília
    expect(await avisarFimDoTeste(madrugada, manda)).toMatchObject({ foraDoHorario: true, avisadas: 0 });
    expect(await avisarFimDoTeste(new Date("2026-11-11T01:00:00Z"), manda)).toMatchObject({ foraDoHorario: true });
    expect(manda).not.toHaveBeenCalled();
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha.lembreteFimDoTesteEm).toBeNull();
  });

  it("se o envio falhar, a marca é desfeita e a próxima rodada tenta de novo", async () => {
    await emTeste(40);
    const quebra = vi.fn<(m: Mensagem) => Promise<undefined>>(async () => {
      throw new Error("Resend fora do ar");
    });
    expect(await avisarFimDoTeste(AGORA, quebra)).toMatchObject({ avisadas: 0, falhas: 1 });
    const [linha] = await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca));
    expect(linha.lembreteFimDoTesteEm).toBeNull();
    const manda = enviar();
    expect(await avisarFimDoTeste(new Date(AGORA.getTime() + HORA), manda)).toMatchObject({ avisadas: 1 });
    expect(manda).toHaveBeenCalledTimes(1);
  });

  it("assinatura ativa (não é teste) nunca recebe o e-mail", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marca, assinaturaId: `sub_ativa_${n}`, criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 36 * 3600, status: "active" }));
    expect(await avisarFimDoTeste(AGORA, enviar())).toMatchObject({ candidatas: 0 });
  });

  it("marca sem dono: conta como sem dono e não marca nada", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marcaSemDono, assinaturaId: `sub_sem_dono_${n}`, criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 36 * 3600, status: "trialing" }));
    const manda = enviar();
    expect(await avisarFimDoTeste(AGORA, manda)).toMatchObject({ candidatas: 1, semDono: 1, avisadas: 0 });
    expect(manda).not.toHaveBeenCalled();
  });
});

describe("o fim do teste sem pagamento (A3, A7, M4, 23/11/2026)", () => {
  type Mensagem = { para: string; assunto: string; html: string };
  const enviar = () => vi.fn<(m: Mensagem) => Promise<undefined>>(async () => undefined);
  const linhaDaMarca = async () => (await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca)))[0];

  /** O teste acabou há 1 hora e o Stripe cancelou (sem cartão). */
  async function testeQueAcabou(opcoes: { cancelaNoFim?: boolean } = {}) {
    const fim = agoraS() - 3600;
    const id = `sub_acabou_${n}`;
    const base = { clienteId: marca, assinaturaId: id, clienteStripeId: `cus_${id}` };
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { ...base, criadoEm: fim - 7 * SEGUNDOS.DIA, status: "trialing", inicio: fim - 7 * SEGUNDOS.DIA, fim, cartao: false }));
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { ...base, criadoEm: fim + 60, status: "canceled", inicio: fim - 7 * SEGUNDOS.DIA, fim, comTeste: true, cancelaNoFim: opcoes.cancelaNoFim }));
    return fim;
  }

  it("a assinatura guarda que começou como teste e que nunca teve pagamento; o portão a barra", async () => {
    await testeQueAcabou();
    const linha = await linhaDaMarca();
    expect(linha).toMatchObject({ status: "canceled", comecouComoTeste: true, primeiroPagamentoEm: null, temFormaDePagamento: false });
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, AGORA, true)).toBe(true);
  });

  it("o e-mail do dia sai uma vez para o dono, com o preço do plano e o link para assinar; não repete", async () => {
    await testeQueAcabou();
    const manda = enviar();
    expect(await avisarTesteTerminado(AGORA, manda)).toMatchObject({ candidatas: 1, avisadas: 1, falhas: 0 });
    expect(manda).toHaveBeenCalledTimes(1);
    const m = manda.mock.calls[0][0];
    expect(m.para).toBe(dono.email);
    expect(m.assunto).toBe("O seu teste grátis terminou");
    expect(m.html).toContain("[teste] Marca do teste");
    expect(m.html).toContain("R$ 1.191 a cada 3 meses");
    expect(m.html).toContain("/assinar");
    expect((await linhaDaMarca()).fimDoTesteAvisadoEm).not.toBeNull();
    const outra = enviar();
    expect(await avisarTesteTerminado(new Date(AGORA.getTime() + HORA), outra)).toMatchObject({ candidatas: 0, avisadas: 0 });
    expect(outra).not.toHaveBeenCalled();
  });

  it("de madrugada não sai, e a marca fica para a próxima rodada; se o envio falhar, desfaz e tenta de novo", async () => {
    await testeQueAcabou();
    const manda = enviar();
    expect(await avisarTesteTerminado(new Date("2026-11-10T07:00:00Z"), manda)).toMatchObject({ foraDoHorario: true, avisadas: 0 });
    expect(manda).not.toHaveBeenCalled();
    const quebra = vi.fn<(m: Mensagem) => Promise<undefined>>(async () => {
      throw new Error("Resend fora do ar");
    });
    expect(await avisarTesteTerminado(AGORA, quebra)).toMatchObject({ avisadas: 0, falhas: 1 });
    expect((await linhaDaMarca()).fimDoTesteAvisadoEm).toBeNull();
    expect(await avisarTesteTerminado(new Date(AGORA.getTime() + HORA), manda)).toMatchObject({ avisadas: 1 });
  });

  it("não sai para quem cancelou por conta própria, para quem já pagou, nem para teste que acabou há mais de 2 dias", async () => {
    await testeQueAcabou({ cancelaNoFim: true });
    const manda = enviar();
    expect(await avisarTesteTerminado(AGORA, manda)).toMatchObject({ candidatas: 0 });
    await db().delete(assinaturas);
    await testeQueAcabou();
    await db().update(assinaturas).set({ primeiroPagamentoEm: new Date(AGORA.getTime() - 30 * 24 * HORA) });
    expect(await avisarTesteTerminado(AGORA, manda)).toMatchObject({ candidatas: 0 });
    await db().update(assinaturas).set({ primeiroPagamentoEm: null });
    expect(await avisarTesteTerminado(new Date(AGORA.getTime() + 3 * 24 * HORA), manda)).toMatchObject({ candidatas: 0 });
    expect(manda).not.toHaveBeenCalled();
  });

  it("marca sem dono: conta como sem dono e não marca nada", async () => {
    const fim = agoraS() - 3600;
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marcaSemDono, assinaturaId: `sub_sd_${n}`, criadoEm: fim + 60, status: "canceled", inicio: fim - 7 * SEGUNDOS.DIA, fim, comTeste: true }));
    const manda = enviar();
    expect(await avisarTesteTerminado(AGORA, manda)).toMatchObject({ candidatas: 1, semDono: 1, avisadas: 0 });
    expect(manda).not.toHaveBeenCalled();
  });

  it("cartão recusado na primeira cobrança de quem nunca pagou: acesso por 3 dias, não pelas semanas do período novo", async () => {
    const fim = agoraS() + 7 * SEGUNDOS.DIA;
    await cadastrarComTeste(marca, `sub_recusa_${n}`, fim);
    const base = { clienteId: marca, assinaturaId: `sub_recusa_${n}`, clienteStripeId: `cus_sub_recusa_${n}` };
    const falhouEm = fim + 10;
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { ...base, criadoEm: falhouEm, status: "past_due", inicio: fim, fim: fim + 90 * SEGUNDOS.DIA }));
    await tratarEventoDoStripe(eventoDeFatura("invoice.payment_failed", { ...base, criadoEm: falhouEm, inicio: fim, fim: fim + 90 * SEGUNDOS.DIA }));
    const linha = await linhaDaMarca();
    expect(linha).toMatchObject({ status: "past_due", primeiroPagamentoEm: null });
    expect(linha.atrasadaDesde?.getTime()).toBe(falhouEm * 1000);
    const em = (dias: number) => new Date((falhouEm + dias * SEGUNDOS.DIA) * 1000);
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, em(2), true)).toBe(false);
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, em(4), true)).toBe(true);
    // O Stripe tenta de novo e falha de novo: a conta dos 3 dias não recomeça.
    await tratarEventoDoStripe(eventoDeFatura("invoice.payment_failed", { ...base, criadoEm: falhouEm + 2 * SEGUNDOS.DIA, inicio: fim, fim: fim + 90 * SEGUNDOS.DIA }));
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { ...base, criadoEm: falhouEm + 2 * SEGUNDOS.DIA, status: "past_due", inicio: fim, fim: fim + 90 * SEGUNDOS.DIA }));
    expect((await linhaDaMarca()).atrasadaDesde?.getTime()).toBe(falhouEm * 1000);
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, em(4), true)).toBe(true);
  });

  it("cartão recusado de quem já pagou: segue a regra de sempre (vale até o fim do período mais a folga)", async () => {
    const fim = agoraS() + 7 * SEGUNDOS.DIA;
    await cadastrarComTeste(marca, `sub_pagou_${n}`, fim);
    const base = { clienteId: marca, assinaturaId: `sub_pagou_${n}`, clienteStripeId: `cus_sub_pagou_${n}` };
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { ...base, criadoEm: fim + 5, status: "active", inicio: fim, fim: fim + 90 * SEGUNDOS.DIA }));
    await tratarEventoDoStripe(eventoDeFatura("invoice.paid", { ...base, criadoEm: fim + 5, inicio: fim, fim: fim + 90 * SEGUNDOS.DIA, valorPago: 119100 }));
    const renovaEm = fim + 90 * SEGUNDOS.DIA;
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { ...base, criadoEm: renovaEm, status: "past_due", inicio: renovaEm, fim: renovaEm + 90 * SEGUNDOS.DIA }));
    const linha = await linhaDaMarca();
    expect(linha.primeiroPagamentoEm).not.toBeNull();
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, new Date((renovaEm + 20 * SEGUNDOS.DIA) * 1000), true)).toBe(false);
  });

  it("o cartão cadastrado no teste sem cartão aparece no aviso da assinatura e muda o e-mail de 2 dias", async () => {
    const fim = agoraS() + 40 * 3600;
    const base = { clienteId: marca, assinaturaId: `sub_cartao_${n}`, clienteStripeId: `cus_sub_cartao_${n}` };
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { ...base, criadoEm: agoraS(), status: "trialing", inicio: agoraS(), fim, cartao: false, comTeste: true }));
    expect((await linhaDaMarca()).temFormaDePagamento).toBe(false);
    const sem = enviar();
    await db().update(assinaturas).set({ lembreteFimDoTesteEm: null });
    await avisarFimDoTeste(AGORA, sem);
    expect(sem.mock.calls[0][0].html).toContain("cadastre o cartão");
    expect(sem.mock.calls[0][0].html).not.toContain("já cadastrou");

    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { ...base, criadoEm: agoraS() + 60, status: "trialing", inicio: agoraS(), fim, cartao: true, comTeste: true }));
    expect((await linhaDaMarca()).temFormaDePagamento).toBe(true);
    await db().update(assinaturas).set({ lembreteFimDoTesteEm: null });
    const com = enviar();
    await avisarFimDoTeste(AGORA, com);
    expect(com.mock.calls[0][0].html).toContain("a primeira cobrança");
  });
});
