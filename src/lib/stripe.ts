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
  criarCheckout(pedido: PedidoDeCheckout): Promise<{ url: string; sessaoId: string }>;
  /**
   * O Checkout que a marca abriu antes, se ainda está aberto (E22 PR 2, item 0b): devolve o endereço dele para o segundo clique reaproveitar. Nulo quando a sessão não existe mais, já foi
   * paga, expirou, não é deste produto (sem `metadata.produto = roteiros`) ou é de outra marca (`client_reference_id` diferente).
   */
  sessaoAberta(sessaoId: string, clienteId: number): Promise<{ url: string } | null>;
  /** Fecha um Checkout aberto (a marca vai ser apagada). Sessão que já não está aberta, ou já não existe, conta como fechada. */
  expirarSessao(sessaoId: string): Promise<void>;
  /** O portal do cliente, com a configuração PRÓPRIA do Roteiros (item 0c): se ela não existe, erro, nunca a configuração padrão da conta (que é do OdontoTech). */
  criarPortal(pedido: { stripeClienteId: string; urlDeVolta: string }): Promise<{ url: string }>;
  /** Cancela a assinatura agora (item 0d: a marca vai ser apagada). Assinatura que já não existe no Stripe conta como cancelada. */
  cancelarAssinatura(stripeAssinaturaId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// A porta simulada
// ---------------------------------------------------------------------------

export type ChamadaSimulada = { metodo: "precoDoPlano" | "criarCheckout" | "sessaoAberta" | "expirarSessao" | "criarPortal" | "cancelarAssinatura"; pedido: unknown };
export const chamadasSimuladas: ChamadaSimulada[] = [];

/** As sessões de Checkout que a porta simulada abriu (id para marca e se ainda está aberta); os testes fecham uma com `fecharSessaoSimulada` para imitar o pagamento ou a expiração. */
type EstadoDasSessoes = { sessoes: Map<string, { clienteId: number; aberta: boolean }>; contador: number };
/** No `globalThis` porque o Next empacota cada rota e cada Server Action à parte: o estado do módulo não é o mesmo entre elas, e o segundo clique de um teste e2e não acharia a sessão do primeiro. */
const globalDasSessoes = globalThis as typeof globalThis & { __sessoesSimuladasRoteiros?: EstadoDasSessoes };
const estadoDasSessoes: EstadoDasSessoes = (globalDasSessoes.__sessoesSimuladasRoteiros ??= { sessoes: new Map(), contador: 0 });

export function fecharSessaoSimulada(sessaoId: string): void {
  const s = estadoDasSessoes.sessoes.get(sessaoId);
  if (s) s.aberta = false;
}

export function limparSessoesSimuladas(): void {
  estadoDasSessoes.sessoes.clear();
  estadoDasSessoes.contador = 0;
}

export function criarPortaSimulada(): PortaStripe {
  return {
    async precoDoPlano(lookupKey) {
      chamadasSimuladas.push({ metodo: "precoDoPlano", pedido: lookupKey });
      return { id: "price_simulado" };
    },
    async criarCheckout(pedido) {
      chamadasSimuladas.push({ metodo: "criarCheckout", pedido });
      estadoDasSessoes.contador += 1;
      const sessaoId = `cs_simulada_${estadoDasSessoes.contador}`;
      estadoDasSessoes.sessoes.set(sessaoId, { clienteId: pedido.clienteId, aberta: true });
      return { url: `${config.appUrl}/assinar?simulado=checkout&sessao=${sessaoId}`, sessaoId };
    },
    async sessaoAberta(sessaoId, clienteId) {
      chamadasSimuladas.push({ metodo: "sessaoAberta", pedido: { sessaoId, clienteId } });
      const s = estadoDasSessoes.sessoes.get(sessaoId);
      if (!s || !s.aberta || s.clienteId !== clienteId) return null;
      return { url: `${config.appUrl}/assinar?simulado=checkout&sessao=${sessaoId}` };
    },
    async expirarSessao(sessaoId) {
      chamadasSimuladas.push({ metodo: "expirarSessao", pedido: sessaoId });
      fecharSessaoSimulada(sessaoId);
    },
    async criarPortal(pedido) {
      chamadasSimuladas.push({ metodo: "criarPortal", pedido });
      return { url: `${config.appUrl}/assinar?simulado=portal` };
    },
    async cancelarAssinatura(stripeAssinaturaId) {
      chamadasSimuladas.push({ metodo: "cancelarAssinatura", pedido: stripeAssinaturaId });
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
  return criarPortaComSdk(new Stripe(chave, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "roteiros-virais" } }));
}

/** A porta sobre um cliente do SDK já pronto. Separada de `criarPortaReal` para os testes darem um SDK de mentira (sem rede) e provarem as regras da conta dividida. */
export function criarPortaComSdk(stripe: Stripe): PortaStripe {
  /** A configuração do portal que é deste produto (criada por `stripe:preparar`, com `metadata.produto = roteiros`). A padrão da conta é do OdontoTech: nunca serve de reserva. */
  async function configuracaoDoPortal(): Promise<string> {
    const lista = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    const nossa = lista.data.find((c) => c.metadata?.produto === METADATA_PRODUTO.produto);
    if (!nossa) throw new ErroStripe("A configuracao do portal do Roteiros nao existe nesta conta (rode npm run stripe:preparar). A padrao da conta nao serve: e do OdontoTech.");
    return nossa.id;
  }

  async function cancelar(stripeAssinaturaId: string): Promise<void> {
    try {
      await stripe.subscriptions.cancel(stripeAssinaturaId);
    } catch (erro) {
      // Já cancelada (ou apagada) no Stripe: o que se queria já aconteceu.
      if ((erro as { code?: string } | null)?.code === "resource_missing") return;
      throw erro;
    }
  }

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
      return { url: sessao.url, sessaoId: sessao.id };
    },
    async sessaoAberta(sessaoId, clienteId) {
      let sessao: Stripe.Checkout.Session;
      try {
        sessao = await stripe.checkout.sessions.retrieve(sessaoId);
      } catch (erro) {
        if ((erro as { code?: string } | null)?.code === "resource_missing") return null;
        throw erro;
      }
      if (sessao.status !== "open" || !sessao.url) return null;
      if (sessao.metadata?.produto !== METADATA_PRODUTO.produto) return null;
      if (sessao.client_reference_id !== String(clienteId)) return null;
      return { url: sessao.url };
    },
    async expirarSessao(sessaoId) {
      let sessao: Stripe.Checkout.Session;
      try {
        sessao = await stripe.checkout.sessions.retrieve(sessaoId);
      } catch (erro) {
        if ((erro as { code?: string } | null)?.code === "resource_missing") return;
        throw erro;
      }
      if (sessao.metadata?.produto !== METADATA_PRODUTO.produto) return;
      if (sessao.status === "open") {
        await stripe.checkout.sessions.expire(sessaoId);
        return;
      }
      // Paga no meio do caminho (o aviso ainda não chegou ao nosso banco): a assinatura que nasceu dela é cancelada aqui.
      const assinaturaId = typeof sessao.subscription === "string" ? sessao.subscription : sessao.subscription?.id;
      if (sessao.status === "complete" && assinaturaId) await cancelar(assinaturaId);
    },
    async criarPortal(pedido) {
      const sessao = await stripe.billingPortal.sessions.create({ customer: pedido.stripeClienteId, return_url: pedido.urlDeVolta, configuration: await configuracaoDoPortal() });
      return { url: sessao.url };
    },
    cancelarAssinatura: cancelar,
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
