import { Resend } from "resend";

import { config } from "./config";

let cliente: Resend | null = null;

function resend(): Resend {
  if (!cliente) cliente = new Resend(config.email.resendKey);
  return cliente;
}

/**
 * Fora de producao, o e-mail sai no log em vez de ser enviado de verdade
 * (plano de execucao, etapa 3), mesmo que exista uma RESEND_API_KEY no
 * `.env` local. Em producao sem chave, tambem cai no log, para nao derrubar
 * o fluxo por uma chave que faltou configurar.
 */
export async function enviarEmail(opcoes: {
  para: string;
  assunto: string;
  html: string;
}): Promise<void> {
  const producao = process.env.NODE_ENV === "production";

  if (!producao || !config.email.resendKey) {
    console.log(`[e-mail simulado] para ${opcoes.para}, assunto "${opcoes.assunto}"`);
    console.log(opcoes.html);
    return;
  }

  await resend().emails.send({
    from: config.email.de,
    to: opcoes.para,
    subject: opcoes.assunto,
    html: opcoes.html,
  });
}
