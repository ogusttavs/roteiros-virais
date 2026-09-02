import { Resend } from "resend";

import { config } from "./config";

let cliente: Resend | null = null;

function resend(): Resend {
  if (!cliente) cliente = new Resend(config.email.resendKey);
  return cliente;
}

/** Nome proprio para nao sumir num catch generico (revisao da etapa 3). */
export class ErroEmail extends Error {}

/**
 * Fora de producao, o e-mail sai no log em vez de ser enviado de verdade
 * (plano de execucao, etapa 3), mesmo que exista uma RESEND_API_KEY no
 * `.env` local. Em producao sem chave, lanca ErroEmail em vez de cair no
 * log em silencio: link magico que some sem aviso e o tipo de falha que
 * ninguem percebe (revisao da etapa 3, PROXIMO.md).
 */
export async function enviarEmail(opcoes: {
  para: string;
  assunto: string;
  html: string;
}): Promise<void> {
  const producao = process.env.NODE_ENV === "production";

  if (!producao) {
    console.log(`[e-mail simulado] para ${opcoes.para}, assunto "${opcoes.assunto}"`);
    console.log(opcoes.html);
    return;
  }

  if (!config.email.resendKey) {
    throw new ErroEmail("RESEND_API_KEY nao configurada em producao; o e-mail nao foi enviado.");
  }

  await resend().emails.send({
    from: config.email.de,
    to: opcoes.para,
    subject: opcoes.assunto,
    html: opcoes.html,
  });
}
