/**
 * E22 PR 1: as regras puras da assinatura. O portão (`assinaturaVale`, `precisaAssinarCom`), a leitura de cada evento do Stripe (`lerEvento`, o filtro `metadata.produto =
 * roteiros` da conta dividida com o OdontoTech) e a frase de estado da lista do admin. Sem banco, sem rede.
 */
import { describe, expect, it } from "vitest";

import { DIAS_DE_FOLGA_DA_RENOVACAO } from "@/config/assinatura";
import type { Assinatura } from "@/db/schema";
import { rotuloDaCobranca } from "@/textos/admin-contas";

import { eventoDeAssinatura, eventoDeCheckout, eventoDeFatura, MARCA_DO_ODONTOTECH, SEGUNDOS } from "../../tests/fixtures/stripe-eventos";

import { assinaturaPrincipal, assinaturaVale, clienteIdDoAviso, ehNosso, lerEvento, precisaAssinarCom, resumirCobranca } from "./assinatura";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-22T12:00:00Z");

function assinatura(extra: Partial<Assinatura> = {}): Assinatura {
  return {
    id: 1,
    clienteId: 1,
    status: "active",
    stripeClienteId: "cus_1",
    stripeAssinaturaId: "sub_1",
    stripePrecoId: "price_1",
    periodoInicio: new Date(AGORA.getTime() - 30 * DIA),
    periodoFim: new Date(AGORA.getTime() + 60 * DIA),
    cancelaNoFimDoPeriodo: false,
    ultimoEventoEm: AGORA,
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...extra,
  };
}

describe("assinaturaVale", () => {
  it.each([
    ["active", true],
    ["trialing", true],
    ["past_due", true],
    ["canceled", false],
    ["unpaid", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["paused", false],
  ] as const)("o status %s vale: %s", (status, esperado) => {
    expect(assinaturaVale({ status, periodoFim: null }, AGORA)).toBe(esperado);
  });

  it("depois do fim do periodo mais a folga, o acesso acaba mesmo com status active (aviso perdido)", () => {
    const fim = new Date(AGORA.getTime() - DIAS_DE_FOLGA_DA_RENOVACAO * DIA - 1000);
    expect(assinaturaVale({ status: "active", periodoFim: fim }, AGORA)).toBe(false);
  });

  it("dentro da folga da renovacao o acesso continua", () => {
    const fim = new Date(AGORA.getTime() - (DIAS_DE_FOLGA_DA_RENOVACAO - 1) * DIA);
    expect(assinaturaVale({ status: "active", periodoFim: fim }, AGORA)).toBe(true);
  });

  it("no limite exato da folga ainda vale; um segundo depois, nao", () => {
    const limite = new Date(AGORA.getTime() - DIAS_DE_FOLGA_DA_RENOVACAO * DIA);
    expect(assinaturaVale({ status: "active", periodoFim: limite }, AGORA)).toBe(true);
    expect(assinaturaVale({ status: "active", periodoFim: new Date(limite.getTime() - 1) }, AGORA)).toBe(false);
  });

  it("status que nao vale nao e salvo por um periodo futuro", () => {
    expect(assinaturaVale({ status: "canceled", periodoFim: new Date(AGORA.getTime() + 30 * DIA) }, AGORA)).toBe(false);
  });
});

describe("precisaAssinarCom (o portao)", () => {
  const ativa = assinatura();
  it("com a cobranca desligada ninguem precisa assinar, nem sem assinatura nem sem cortesia", () => {
    expect(precisaAssinarCom({ cobrancaAtiva: false, cortesia: false, assinaturas: [], agora: AGORA })).toBe(false);
  });
  it("ligada, marca sem assinatura e sem cortesia precisa assinar", () => {
    expect(precisaAssinarCom({ cobrancaAtiva: true, cortesia: false, assinaturas: [], agora: AGORA })).toBe(true);
  });
  it("ligada, cortesia dispensa", () => {
    expect(precisaAssinarCom({ cobrancaAtiva: true, cortesia: true, assinaturas: [], agora: AGORA })).toBe(false);
  });
  it("ligada, assinatura que vale dispensa", () => {
    expect(precisaAssinarCom({ cobrancaAtiva: true, cortesia: false, assinaturas: [ativa], agora: AGORA })).toBe(false);
  });
  it("ligada, assinatura cancelada nao dispensa; uma cancelada e uma ativa dispensam", () => {
    const cancelada = assinatura({ status: "canceled", id: 2 });
    expect(precisaAssinarCom({ cobrancaAtiva: true, cortesia: false, assinaturas: [cancelada], agora: AGORA })).toBe(true);
    expect(precisaAssinarCom({ cobrancaAtiva: true, cortesia: false, assinaturas: [cancelada, ativa], agora: AGORA })).toBe(false);
  });
});

describe("assinaturaPrincipal e resumirCobranca", () => {
  it("a que vale ganha; sem nenhuma que valha, a mais nova (primeira da lista)", () => {
    const nova = assinatura({ id: 2, status: "canceled" });
    const velha = assinatura({ id: 1, status: "active" });
    expect(assinaturaPrincipal([nova, velha], AGORA)?.id).toBe(1);
    expect(assinaturaPrincipal([nova], AGORA)?.id).toBe(2);
    expect(assinaturaPrincipal([], AGORA)).toBeNull();
  });
  it("o resumo diz se vale", () => {
    expect(resumirCobranca(false, [assinatura()], AGORA).assinatura?.vale).toBe(true);
    expect(resumirCobranca(true, [], AGORA)).toEqual({ cortesia: true, assinatura: null });
  });
});

describe("ehNosso e clienteIdDoAviso", () => {
  it("so metadata.produto = roteiros e nosso", () => {
    expect(ehNosso({ produto: "roteiros" })).toBe(true);
    expect(ehNosso({ produto: "odontotech" })).toBe(false);
    expect(ehNosso({})).toBe(false);
    expect(ehNosso(null)).toBe(false);
    expect(ehNosso(undefined)).toBe(false);
    expect(ehNosso("roteiros")).toBe(false);
    expect(ehNosso({ produto: "Roteiros" })).toBe(false);
  });
  it("a marca vem do metadata ou da referencia, so inteiro positivo, e os dois tem de concordar", () => {
    expect(clienteIdDoAviso({ cliente_id: "42" })).toBe(42);
    expect(clienteIdDoAviso({}, "7")).toBe(7);
    expect(clienteIdDoAviso({ cliente_id: "42" }, "42")).toBe(42);
    expect(clienteIdDoAviso({ cliente_id: "42" }, "43")).toBeNull();
    expect(clienteIdDoAviso({ cliente_id: "0" })).toBeNull();
    expect(clienteIdDoAviso({ cliente_id: "-3" })).toBeNull();
    expect(clienteIdDoAviso({ cliente_id: "1.5" })).toBeNull();
    expect(clienteIdDoAviso({ cliente_id: "abc" })).toBeNull();
    expect(clienteIdDoAviso({ cliente_id: "99999999999" })).toBeNull();
    expect(clienteIdDoAviso({})).toBeNull();
    expect(clienteIdDoAviso(null, undefined)).toBeNull();
  });
});

describe("lerEvento: o que e nosso e o que cada evento muda", () => {
  it("tipo que nao tratamos e ignorado", () => {
    const e = eventoDeAssinatura("customer.subscription.updated", { clienteId: 1 });
    expect(lerEvento({ ...e, type: "customer.created" })).toEqual({ tipo: "ignorar", motivo: "tipo nao tratado" });
    expect(lerEvento({ ...e, type: "invoice.finalized" }).tipo).toBe("ignorar");
  });

  it("assinatura sem metadata.produto, ou com o metadata do OdontoTech, e ignorada", () => {
    for (const tipo of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"] as const) {
      expect(lerEvento(eventoDeAssinatura(tipo, { metadata: {} })).tipo).toBe("ignorar");
      expect(lerEvento(eventoDeAssinatura(tipo, { metadata: { ...MARCA_DO_ODONTOTECH } })).tipo).toBe("ignorar");
    }
  });

  it("checkout sem metadata.produto, ou que nao e de assinatura, ou sem assinatura, e ignorado", () => {
    expect(lerEvento(eventoDeCheckout({ metadata: {} })).tipo).toBe("ignorar");
    expect(lerEvento(eventoDeCheckout({ metadata: { ...MARCA_DO_ODONTOTECH } })).tipo).toBe("ignorar");
    expect(lerEvento(eventoDeCheckout({ modo: "payment" })).tipo).toBe("ignorar");
    expect(lerEvento(eventoDeCheckout({ semAssinatura: true })).tipo).toBe("ignorar");
  });

  it("checkout concluido e pago cria como active; sem pagamento, como incomplete; nunca mexe no status de uma linha que ja existe", () => {
    const pago = lerEvento(eventoDeCheckout({ clienteId: 9, pagamento: "paid" }));
    expect(pago).toMatchObject({ tipo: "tratar", verificar: false, mudanca: { stripeAssinaturaId: "sub_teste_1", stripeClienteId: "cus_teste_1", clienteId: 9, statusSeNova: "active" } });
    if (pago.tipo === "tratar") expect(pago.mudanca.status).toBeUndefined();
    const aberto = lerEvento(eventoDeCheckout({ clienteId: 9, pagamento: "unpaid" }));
    expect(aberto).toMatchObject({ tipo: "tratar", mudanca: { statusSeNova: "incomplete" } });
  });

  it("checkout: client_reference_id e metadata.cliente_id que discordam deixam a marca desconhecida (nada e criado para uma marca duvidosa)", () => {
    const e = eventoDeCheckout({ clienteId: 9, clientReferenceId: "10" });
    expect(lerEvento(e)).toMatchObject({ tipo: "tratar", mudanca: { clienteId: null } });
  });

  it("assinatura: o status, o periodo dos itens, o preco e o cancelamento no fim vem do evento", () => {
    const l = lerEvento(eventoDeAssinatura("customer.subscription.updated", { clienteId: 3, status: "past_due", inicio: 1000, fim: 2000, cancelaNoFim: true, precoId: "price_X" }));
    expect(l).toMatchObject({
      tipo: "tratar",
      verificar: false,
      mudanca: { stripeAssinaturaId: "sub_teste_1", clienteId: 3, status: "past_due", stripePrecoId: "price_X", cancelaNoFimDoPeriodo: true },
    });
    if (l.tipo === "tratar") {
      expect(l.mudanca.periodoInicio?.getTime()).toBe(1_000_000);
      expect(l.mudanca.periodoFim?.getTime()).toBe(2_000_000);
    }
  });

  it("assinatura no formato antigo da API (periodo na raiz) tambem e lida", () => {
    const l = lerEvento(eventoDeAssinatura("customer.subscription.created", { clienteId: 3, inicio: 1000, fim: 2000, antigaApi: true }));
    if (l.tipo !== "tratar") throw new Error("devia tratar");
    expect(l.mudanca.periodoFim?.getTime()).toBe(2_000_000);
  });

  it("assinatura apagada vira canceled, qualquer que seja o status que o evento traga", () => {
    const l = lerEvento(eventoDeAssinatura("customer.subscription.deleted", { clienteId: 3, status: "active" }));
    expect(l).toMatchObject({ tipo: "tratar", mudanca: { status: "canceled", statusSeNova: "canceled" } });
  });

  it("status desconhecido do Stripe nunca abre o acesso (vira incomplete)", () => {
    const l = lerEvento(eventoDeAssinatura("customer.subscription.updated", { clienteId: 3, status: "novo_status_do_futuro" }));
    expect(l).toMatchObject({ tipo: "tratar", mudanca: { status: "incomplete" } });
  });

  it("cancelamento agendado por cancel_at tambem conta como 'cancela no fim do periodo'", () => {
    const l = lerEvento(eventoDeAssinatura("customer.subscription.updated", { clienteId: 3, cancelAt: 1_800_000_000 }));
    expect(l).toMatchObject({ mudanca: { cancelaNoFimDoPeriodo: true } });
  });

  it("fatura paga: a assinatura vem do parent (API nova) ou da raiz (API antiga); o periodo vem da linha; fatura com metadata nosso nao precisa ja estar no banco", () => {
    for (const antigaApi of [false, true]) {
      const l = lerEvento(eventoDeFatura("invoice.paid", { clienteId: 5, inicio: 10, fim: 20, antigaApi }));
      expect(l).toMatchObject({ tipo: "tratar", verificar: false, mudanca: { stripeAssinaturaId: "sub_teste_1", clienteId: 5, status: "active", statusSeNova: "active" } });
      if (l.tipo === "tratar") expect(l.mudanca.periodoFim?.getTime()).toBe(20_000);
    }
  });

  it("fatura sem a nossa marca so vale se a assinatura ja estiver no banco (verificar)", () => {
    const l = lerEvento(eventoDeFatura("invoice.paid", { metadata: {} }));
    expect(l).toMatchObject({ tipo: "tratar", verificar: true });
    const odonto = lerEvento(eventoDeFatura("invoice.payment_failed", { metadata: { ...MARCA_DO_ODONTOTECH } }));
    expect(odonto).toMatchObject({ tipo: "tratar", verificar: true });
  });

  it("fatura sem assinatura (cobranca avulsa) e ignorada", () => {
    expect(lerEvento(eventoDeFatura("invoice.paid", { semAssinatura: true })).tipo).toBe("ignorar");
  });

  it("fatura que falhou vira past_due para quem ja e assinante e incomplete (sem acesso) se a assinatura for nova", () => {
    const l = lerEvento(eventoDeFatura("invoice.payment_failed", { clienteId: 5 }));
    expect(l).toMatchObject({ tipo: "tratar", mudanca: { status: "past_due", statusSeNova: "incomplete" } });
  });
});

describe("rotuloDaCobranca (a coluna Assinatura do admin)", () => {
  const r = (cortesia: boolean, a: Partial<Assinatura> | null) => rotuloDaCobranca(resumirCobranca(cortesia, a ? [assinatura(a)] : [], AGORA));
  it("cortesia vence", () => expect(r(true, { status: "canceled" })).toBe("Cortesia"));
  it("sem assinatura", () => expect(r(false, null)).toBe("Sem assinatura"));
  it("ativa com data", () => expect(r(false, {})).toMatch(/^Ativa até \d\d\/\d\d\/\d\d$/));
  it("ativa sem data", () => expect(r(false, { periodoFim: null })).toBe("Ativa"));
  it("cancela no fim", () => expect(r(false, { cancelaNoFimDoPeriodo: true })).toMatch(/^Cancela em /));
  it("atrasada", () => expect(r(false, { status: "past_due" })).toBe("Pagamento atrasado"));
  it("cancelada", () => expect(r(false, { status: "canceled" })).toBe("Cancelada"));
  it("incompleta", () => expect(r(false, { status: "incomplete" })).toBe("Não concluída"));
  it("unpaid", () => expect(r(false, { status: "unpaid" })).toBe("Pagamento atrasado"));
  it("o formato de SEGUNDOS exportado pela fixture e coerente", () => expect(SEGUNDOS.DIA).toBe(86400));
});
