import { NextResponse, type NextRequest } from "next/server";

import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { conferirAviso, ErroAssinaturaDoAviso } from "@/lib/stripe";
import { tratarEventoDoStripe } from "@/servicos/assinatura";

export const dynamic = "force-dynamic";

/**
 * E22 PR 1: o aviso (webhook) do Stripe. Fica fora do cookie de sessão (`middleware.ts`, quem chama é o Stripe); a autenticação é a assinatura do corpo com
 * `STRIPE_WEBHOOK_SECRET`, conferida antes de qualquer outra coisa e sobre o corpo CRU (por isso `req.text()`, nunca `req.json()`).
 *
 * Respostas: 503 sem o segredo configurado (falha fechada: nunca aceita aviso sem conferir); 400 com assinatura que não bate; 500 se o tratamento falhar (o Stripe reenvia;
 * a transação desfez o id do evento); 200 para tudo que foi tratado, repetido ou ignorado (evento do OdontoTech, tipo que não tratamos). O corpo da resposta não diz nada
 * além de `ok`.
 */
export async function POST(req: NextRequest) {
  if (!config.cobranca.webhookSecret) {
    logger.error("stripe: STRIPE_WEBHOOK_SECRET nao esta definido; aviso recusado");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const corpo = await req.text();
  let evento;
  try {
    evento = conferirAviso(corpo, req.headers.get("stripe-signature"), config.cobranca.webhookSecret);
  } catch (erro) {
    if (erro instanceof ErroAssinaturaDoAviso) {
      logger.warn({ motivo: erro.message }, "stripe: aviso com assinatura invalida recusado");
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    throw erro;
  }

  try {
    const resultado = await tratarEventoDoStripe(evento);
    logger.info({ eventoId: evento.id, tipo: evento.type, resultado }, "stripe: aviso recebido");
    return NextResponse.json({ ok: true });
  } catch (erro) {
    logger.error({ err: erro, eventoId: evento.id, tipo: evento.type }, "stripe: o tratamento do aviso falhou; o Stripe vai reenviar");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
