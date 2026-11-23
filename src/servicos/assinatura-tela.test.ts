/**
 * E22 PR 2: a situação da assinatura que as telas mostram (puro). O acesso em si é de `assinaturaVale` (`assinatura.test.ts`); aqui só se prova o que a pessoa lê.
 */
import { describe, expect, it } from "vitest";

import type { Assinatura } from "@/db/schema";

import { situacaoDaAssinatura } from "./assinatura-tela";

const AGORA = new Date("2026-11-10T12:00:00Z");
const DIA = 24 * 60 * 60 * 1000;

function sub(parcial: Partial<Assinatura>): Assinatura {
  return {
    id: 1,
    clienteId: 1,
    status: "active",
    stripeClienteId: "cus_1",
    stripeAssinaturaId: "sub_1",
    stripePrecoId: null,
    periodoInicio: null,
    periodoFim: new Date(AGORA.getTime() + 30 * DIA),
    cancelaNoFimDoPeriodo: false,
    ultimoEventoEm: AGORA,
    lembreteFimDoTesteEm: null,
    comecouComoTeste: false,
    // Por padrão, quem já pagou: os testes que provam o fim do teste sobrepõem os dois campos.
    primeiroPagamentoEm: new Date(AGORA.getTime() - 60 * DIA),
    atrasadaDesde: null,
    temFormaDePagamento: false,
    fimDoTesteAvisadoEm: null,
    criadoEm: new Date(AGORA.getTime() - 60 * DIA),
    atualizadoEm: AGORA,
    ...parcial,
  };
}

describe("situacaoDaAssinatura", () => {
  it("sem assinatura nenhuma: nunca, sem acesso e sem portal", () => {
    expect(situacaoDaAssinatura(false, [], AGORA)).toMatchObject({ tipo: "nunca", temAcesso: false, status: null, podeAbrirOPortal: false });
  });

  it("cortesia vale sobre tudo e dá acesso, com ou sem assinatura", () => {
    expect(situacaoDaAssinatura(true, [], AGORA)).toMatchObject({ tipo: "cortesia", temAcesso: true });
    expect(situacaoDaAssinatura(true, [sub({ status: "canceled" })], AGORA)).toMatchObject({ tipo: "cortesia", temAcesso: true });
  });

  it("assinatura ativa em dia: ativa, com a data do fim do período", () => {
    const s = situacaoDaAssinatura(false, [sub({})], AGORA);
    expect(s).toMatchObject({ tipo: "ativa", temAcesso: true, status: "active", cancelaNoFim: false, podeAbrirOPortal: true });
    expect(s.periodoFim?.getTime()).toBe(AGORA.getTime() + 30 * DIA);
  });

  it("cancelada no portal mas ainda dentro do período pago: continua ativa e diz que não renova", () => {
    expect(situacaoDaAssinatura(false, [sub({ cancelaNoFimDoPeriodo: true })], AGORA)).toMatchObject({ tipo: "ativa", temAcesso: true, cancelaNoFim: true });
  });

  it("pagamento atrasado dentro da folga: atrasada, ainda com acesso", () => {
    const s = situacaoDaAssinatura(false, [sub({ status: "past_due", periodoFim: new Date(AGORA.getTime() - 1 * DIA) })], AGORA);
    expect(s).toMatchObject({ tipo: "atrasada", temAcesso: true });
  });

  it("pagamento atrasado depois da folga, ou não pago: cartão, sem acesso", () => {
    const velho = new Date(AGORA.getTime() - 10 * DIA);
    expect(situacaoDaAssinatura(false, [sub({ status: "past_due", periodoFim: velho })], AGORA)).toMatchObject({ tipo: "cartao", temAcesso: false });
    expect(situacaoDaAssinatura(false, [sub({ status: "unpaid" })], AGORA)).toMatchObject({ tipo: "cartao", temAcesso: false });
  });

  it("ativa no banco mas com o período vencido há muito (aviso de renovação perdido): cartão, sem acesso", () => {
    expect(situacaoDaAssinatura(false, [sub({ status: "active", periodoFim: new Date(AGORA.getTime() - 10 * DIA) })], AGORA)).toMatchObject({ tipo: "cartao", temAcesso: false });
  });

  it("cancelada ou pagamento não concluído: encerrada, e o portal ainda abre (as faturas)", () => {
    expect(situacaoDaAssinatura(false, [sub({ status: "canceled" })], AGORA)).toMatchObject({ tipo: "encerrada", temAcesso: false, podeAbrirOPortal: true });
    expect(situacaoDaAssinatura(false, [sub({ status: "incomplete_expired" })], AGORA)).toMatchObject({ tipo: "encerrada" });
    expect(situacaoDaAssinatura(false, [sub({ status: "paused" })], AGORA)).toMatchObject({ tipo: "encerrada" });
  });

  it("pagamento começado e ainda não confirmado: aguardando", () => {
    expect(situacaoDaAssinatura(false, [sub({ status: "incomplete", periodoFim: null })], AGORA)).toMatchObject({ tipo: "aguardando", temAcesso: false });
  });

  it("com uma cancelada e uma nova que vale, conta a que vale", () => {
    const velha = sub({ id: 1, status: "canceled", stripeAssinaturaId: "sub_velha", criadoEm: new Date(AGORA.getTime() - 200 * DIA) });
    const nova = sub({ id: 2, stripeAssinaturaId: "sub_nova", criadoEm: new Date(AGORA.getTime() - 5 * DIA) });
    expect(situacaoDaAssinatura(false, [nova, velha], AGORA)).toMatchObject({ tipo: "ativa", status: "active" });
  });

  it("em teste grátis (trialing) dentro do prazo: teste, com acesso e a data do fim; cancelando, continua teste e diz que não renova", () => {
    const fim = new Date(AGORA.getTime() + 5 * DIA);
    expect(situacaoDaAssinatura(false, [sub({ status: "trialing", periodoFim: fim })], AGORA)).toMatchObject({ tipo: "teste", temAcesso: true, status: "trialing", cancelaNoFim: false, podeAbrirOPortal: true });
    expect(situacaoDaAssinatura(false, [sub({ status: "trialing", periodoFim: fim, cancelaNoFimDoPeriodo: true })], AGORA)).toMatchObject({ tipo: "teste", cancelaNoFim: true });
  });

  it("teste que passou do fim mais a folga sem aviso nenhum: cartão, sem acesso (o Stripe cancela ou cobra; o portão não deixa o teste valer para sempre)", () => {
    expect(situacaoDaAssinatura(false, [sub({ status: "trialing", periodoFim: new Date(AGORA.getTime() - 10 * DIA) })], AGORA)).toMatchObject({ tipo: "cartao", temAcesso: false });
  });
});

describe("o fim do teste grátis (A3, M4, 23/11/2026)", () => {
  const teste = (parcial: Partial<Assinatura>) => sub({ comecouComoTeste: true, primeiroPagamentoEm: null, ...parcial });

  it("teste que acabou sem pagamento (o Stripe cancelou): testeTerminou, sem acesso", () => {
    const s = situacaoDaAssinatura(false, [teste({ status: "canceled", periodoFim: new Date(AGORA.getTime() - DIA) })], AGORA);
    expect(s).toMatchObject({ tipo: "testeTerminou", temAcesso: false });
  });

  it("a cancelada de quem pagou alguma vez continua encerrada; e cancelada que não foi teste também", () => {
    expect(situacaoDaAssinatura(false, [sub({ status: "canceled", comecouComoTeste: true })], AGORA).tipo).toBe("encerrada");
    expect(situacaoDaAssinatura(false, [sub({ status: "canceled", primeiroPagamentoEm: null })], AGORA).tipo).toBe("encerrada");
  });

  it("cartão que falhou há mais de 3 dias, de quem nunca pagou: sem acesso e pede para acertar o cartão; dentro dos 3 dias, atrasada com acesso", () => {
    const fora = situacaoDaAssinatura(false, [teste({ status: "past_due", atrasadaDesde: new Date(AGORA.getTime() - 4 * DIA), periodoFim: new Date(AGORA.getTime() + 80 * DIA) })], AGORA);
    expect(fora).toMatchObject({ tipo: "cartao", temAcesso: false });
    const dentro = situacaoDaAssinatura(false, [teste({ status: "past_due", atrasadaDesde: new Date(AGORA.getTime() - 1 * DIA), periodoFim: new Date(AGORA.getTime() + 80 * DIA) })], AGORA);
    expect(dentro).toMatchObject({ tipo: "atrasada", temAcesso: true });
  });

  it("temCartao vem da assinatura que conta", () => {
    expect(situacaoDaAssinatura(false, [sub({ status: "trialing", temFormaDePagamento: true })], AGORA).temCartao).toBe(true);
    expect(situacaoDaAssinatura(false, [sub({ status: "trialing" })], AGORA).temCartao).toBe(false);
  });
});
