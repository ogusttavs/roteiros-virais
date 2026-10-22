/**
 * E22 PR 1: a porta única para o Stripe. Tudo que o produto faz com o Stripe passa por aqui (criar a sessão do Checkout, abrir o portal do cliente, achar o preço do
 * plano, conferir a assinatura de um aviso); o resto do código recebe a `PortaStripe` e nunca importa o SDK.
 *
 * Nos testes a porta é a simulada (`config.cobranca.provedor === "mock"`, forçado pelo Vitest e pelo Playwright): ela devolve endereços de mentira e guarda as
 * chamadas em `chamadasSimuladas`. Quem quer outro comportamento (um erro do Stripe, por exemplo) troca a porta com `usarPortaStripe`. A porta real recusa existir dentro do
 * Vitest, mesmo com a chave de teste no `.env`: nenhum teste chama o Stripe de verdade.
 */
import Stripe from "stripe";

import { METADATA_PRODUTO } from "@/config/assinatura";

import { config } from "./config";

/** O pedaço do evento que o produto usa; o SDK devolve mais coisa, mas o tratamento só depende disto (e dá para fabricar nos testes). */
export type EventoDoStripe = {
  id: string;
  type: string;
  /** Segundos desde 1970 (o `created` do Stripe). */
  created: number;
  data: { object: Record<string, unknown> };
};

/** O Stripe recusou ou falhou; a mensagem técnica fica no log, a frase da pessoa é de quem chama. */
export class ErroStripe extends Error {}

/** A assinatura do aviso não confere (ou falta o segredo ou o cabeçalho). */
export class ErroAssinaturaDoAviso extends Error {}

export type PedidoDeCheckout = {
  precoId: string;
  clienteId: number;
  /** Quando a marca já tem cliente no Stripe, reaproveita; senão o Stripe cria a partir do e-mail. */
  stripeClienteId: string | null;
  email: string;
  urlDeSucesso: string;
  urlDeCancelar: string;
};

export interface PortaStripe {
  /** O preço do plano pela chave de busca; nulo quando não existe ou quando não é deste produto (sem `metadata.produto = roteiros`). */
  precoDoPlano(lookupKey: string): Promise<{ id: string } | null>;
  criarCheckout(pedido: PedidoDeCheckout): Promise<{ url: string }>;
  criarPortal(pedido: { stripeClienteId: string; urlDeVolta: string }): Promise<{ url: string }>;
}

// ---------------------------------------------------------------------------
// A porta simulada
// ---------------------------------------------------------------------------

export type ChamadaSimulada = { metodo: "precoDoPlano" | "criarCheckout" | "criarPortal"; pedido: unknown };
export const chamadasSimuladas: ChamadaSimulada[] = [];

export function criarPortaSimulada(): PortaStripe {
  return {
    async precoDoPlano(lookupKey) {
      chamadasSimuladas.push({ metodo: "precoDoPlano", pedido: lookupKey });
      return { id: "price_simulado" };
    },
    async criarCheckout(pedido) {
      chamadasSimuladas.push({ metodo: "criarCheckout", pedido });
      return { url: `${config.appUrl}/assinar?simulado=checkout` };
    },
    async criarPortal(pedido) {
      chamadasSimuladas.push({ metodo: "criarPortal", pedido });
      return { url: `${config.appUrl}/assinar?simulado=portal` };
    },
  };
}

// ---------------------------------------------------------------------------
// A porta de verdade
// ---------------------------------------------------------------------------

export function criarPortaReal(chave: string): PortaStripe {
  if (process.env.VITEST) {
    throw new ErroStripe("A porta real do Stripe nao existe dentro do Vitest: os testes usam a simulada.");
  }
  if (!chave) throw new ErroStripe("STRIPE_SECRET_KEY nao esta definida.");
  const stripe = new Stripe(chave, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "roteiros-virais" } });

  return {
    async precoDoPlano(lookupKey) {
      const lista = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
      const preco = lista.data[0];
      // A chave de busca é única na conta, mas conferir a marca do preço custa nada e é a regra da conta dividida.
      if (!preco || preco.metadata?.produto !== METADATA_PRODUTO.produto) return null;
      return { id: preco.id };
    },
    async criarCheckout(pedido) {
      const metadata = { ...METADATA_PRODUTO, cliente_id: String(pedido.clienteId) };
      const sessao = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: pedido.precoId, quantity: 1 }],
        client_reference_id: String(pedido.clienteId),
        metadata,
        subscription_data: { metadata },
        // Só cartão por enquanto (Pix e boleto estão desligados na conta; decisão do Gustavo, 22/10/2026).
        allowed_payment_method_types: ["card"],
        locale: "pt-BR",
        success_url: pedido.urlDeSucesso,
        cancel_url: pedido.urlDeCancelar,
        ...(pedido.stripeClienteId ? { customer: pedido.stripeClienteId } : { customer_email: pedido.email }),
      });
      if (!sessao.url) throw new ErroStripe("O Stripe nao devolveu o endereco do Checkout.");
      return { url: sessao.url };
    },
    async criarPortal(pedido) {
      const sessao = await stripe.billingPortal.sessions.create({ customer: pedido.stripeClienteId, return_url: pedido.urlDeVolta });
      return { url: sessao.url };
    },
  };
}

// ---------------------------------------------------------------------------
// Qual porta vale
// ---------------------------------------------------------------------------

let porta: PortaStripe | null = null;

/** Troca a porta (testes). Sem argumento, volta à escolha pela configuração. */
export function usarPortaStripe(nova?: PortaStripe): void {
  porta = nova ?? null;
}

export function portaStripe(): PortaStripe {
  if (porta) return porta;
  porta = config.cobranca.provedor === "stripe" ? criarPortaReal(config.cobranca.stripeSecretKey) : criarPortaSimulada();
  return porta;
}

// ---------------------------------------------------------------------------
// A conferência do aviso (webhook)
// ---------------------------------------------------------------------------

/**
 * Confere a assinatura do aviso com o segredo e devolve o evento. É criptografia local (HMAC), não chama o Stripe, então roda igual nos testes. Sem segredo, sem
 * cabeçalho, ou com assinatura que não bate: `ErroAssinaturaDoAviso`. Nunca devolve um evento não conferido.
 */
export function conferirAviso(corpo: string, cabecalhoDaAssinatura: string | null, segredo: string): EventoDoStripe {
  if (!segredo) throw new ErroAssinaturaDoAviso("STRIPE_WEBHOOK_SECRET nao esta definido.");
  if (!cabecalhoDaAssinatura) throw new ErroAssinaturaDoAviso("Faltou o cabecalho stripe-signature.");
  try {
    const evento = Stripe.webhooks.constructEvent(corpo, cabecalhoDaAssinatura, segredo);
    return { id: evento.id, type: evento.type, created: evento.created, data: { object: evento.data.object as unknown as Record<string, unknown> } };
  } catch (erro) {
    throw new ErroAssinaturaDoAviso(erro instanceof Error ? erro.message : "assinatura invalida");
  }
}
