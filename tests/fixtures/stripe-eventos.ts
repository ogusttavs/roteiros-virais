/**
 * E22 PR 1: eventos do Stripe fabricados para os testes (nenhum vem da rede). Os formatos seguem o SDK 23 / API 2026-09-30: o período fica em cada item da assinatura e a
 * fatura aponta a assinatura em `parent.subscription_details`. `antigaApi` monta o formato velho (período e `subscription` na raiz) para provar que o leitor aceita os dois.
 */
import type { EventoDoStripe } from "@/lib/stripe";

export const NOSSA_MARCA = { produto: "roteiros" } as const;
/** O que o OdontoTech põe nos objetos dele (outro produto na mesma conta) ou nada. */
export const MARCA_DO_ODONTOTECH = { produto: "odontotech" } as const;

const T0 = 1_790_000_000; // segundos; 2026-09-21

type Opcoes = {
  id?: string;
  criadoEm?: number;
  metadata?: Record<string, string> | null;
  assinaturaId?: string;
  clienteStripeId?: string;
  precoId?: string;
};

let contador = 0;
const proximoId = (prefixo: string) => `${prefixo}_teste_${++contador}`;

export function eventoDeAssinatura(
  tipo: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
  opcoes: Opcoes & { clienteId?: number; status?: string; inicio?: number; fim?: number; cancelaNoFim?: boolean; cancelAt?: number | null; antigaApi?: boolean },
): EventoDoStripe {
  const metadata = opcoes.metadata === undefined ? { ...NOSSA_MARCA, cliente_id: String(opcoes.clienteId ?? 1) } : opcoes.metadata;
  const inicio = opcoes.inicio ?? T0;
  const fim = opcoes.fim ?? T0 + 90 * 86400;
  return {
    id: opcoes.id ?? proximoId("evt"),
    type: tipo,
    created: opcoes.criadoEm ?? T0,
    data: {
      object: {
        id: opcoes.assinaturaId ?? "sub_teste_1",
        object: "subscription",
        customer: opcoes.clienteStripeId ?? "cus_teste_1",
        status: opcoes.status ?? "active",
        metadata: metadata ?? {},
        cancel_at_period_end: opcoes.cancelaNoFim ?? false,
        cancel_at: opcoes.cancelAt ?? null,
        ...(opcoes.antigaApi ? { current_period_start: inicio, current_period_end: fim } : {}),
        items: { data: [{ price: { id: opcoes.precoId ?? "price_teste_1" }, ...(opcoes.antigaApi ? {} : { current_period_start: inicio, current_period_end: fim }) }] },
      },
    },
  };
}

export function eventoDeCheckout(opcoes: Opcoes & { clienteId?: number; pagamento?: string; modo?: string; semAssinatura?: boolean; clientReferenceId?: string | null }): EventoDoStripe {
  const metadata = opcoes.metadata === undefined ? { ...NOSSA_MARCA, cliente_id: String(opcoes.clienteId ?? 1) } : opcoes.metadata;
  return {
    id: opcoes.id ?? proximoId("evt"),
    type: "checkout.session.completed",
    created: opcoes.criadoEm ?? T0,
    data: {
      object: {
        id: proximoId("cs"),
        object: "checkout.session",
        mode: opcoes.modo ?? "subscription",
        payment_status: opcoes.pagamento ?? "paid",
        customer: opcoes.clienteStripeId ?? "cus_teste_1",
        subscription: opcoes.semAssinatura ? null : (opcoes.assinaturaId ?? "sub_teste_1"),
        client_reference_id: opcoes.clientReferenceId === undefined ? String(opcoes.clienteId ?? 1) : opcoes.clientReferenceId,
        metadata: metadata ?? {},
      },
    },
  };
}

export function eventoDeFatura(
  tipo: "invoice.paid" | "invoice.payment_failed",
  opcoes: Opcoes & { clienteId?: number; inicio?: number; fim?: number; antigaApi?: boolean; semAssinatura?: boolean },
): EventoDoStripe {
  const metadata = opcoes.metadata === undefined ? { ...NOSSA_MARCA, cliente_id: String(opcoes.clienteId ?? 1) } : opcoes.metadata;
  const assinaturaId = opcoes.semAssinatura ? null : (opcoes.assinaturaId ?? "sub_teste_1");
  const inicio = opcoes.inicio ?? T0 + 90 * 86400;
  const fim = opcoes.fim ?? T0 + 180 * 86400;
  return {
    id: opcoes.id ?? proximoId("evt"),
    type: tipo,
    created: opcoes.criadoEm ?? T0 + 90 * 86400,
    data: {
      object: {
        id: proximoId("in"),
        object: "invoice",
        customer: opcoes.clienteStripeId ?? "cus_teste_1",
        lines: { data: [{ period: { start: inicio, end: fim } }] },
        ...(opcoes.antigaApi
          ? { subscription: assinaturaId, subscription_details: { metadata: metadata ?? {} } }
          : { parent: { type: "subscription_details", subscription_details: { subscription: assinaturaId, metadata: metadata ?? {} } } }),
      },
    },
  };
}

export const SEGUNDOS = { T0, DIA: 86400 };
