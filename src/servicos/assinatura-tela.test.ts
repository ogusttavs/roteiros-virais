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
});
