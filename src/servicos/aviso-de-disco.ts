/**
 * O aviso do alarme do disco (29/10/2026), pelo mesmo caminho do aviso da leitura parada: e-mail para os admins (e o `EMAIL_ACOMPANHAMENTO`) pela Resend, mais o registro no Sentry. A linha no Início
 * do admin vem do estado guardado (`servicos/disco.ts`), não daqui. A regra de "um por nível por dia" fica no estado; aqui só se manda. Falha de envio nunca derruba o job.
 */
import * as Sentry from "@sentry/node";

import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { textosAvisoDeDisco, type NumerosDoAviso, type TipoDoAviso } from "@/textos/aviso-disco";

import { destinatariosDoAviso } from "./aviso-de-leitura";

export type ResultadoDoAvisoDeDisco = { enviado: boolean; motivo?: "sem destinatario" | "falha no envio"; destinatarios?: number };

export async function avisarDisco(tipo: TipoDoAviso, numeros: NumerosDoAviso, enviar: typeof enviarEmail = enviarEmail): Promise<ResultadoDoAvisoDeDisco> {
  const para = await destinatariosDoAviso();
  if (para.length === 0) {
    logger.warn("disco: ha aviso a mandar, mas nao ha admin nem EMAIL_ACOMPANHAMENTO para receber");
    return { enviado: false, motivo: "sem destinatario" };
  }
  const assunto = textosAvisoDeDisco.assunto(tipo, numeros);
  const html = textosAvisoDeDisco.corpo(tipo, numeros, `${config.appUrl}/admin`);
  const resultados = await Promise.allSettled(para.map((email) => enviar({ para: email, assunto, html })));
  const enviados = resultados.filter((r) => r.status === "fulfilled").length;
  for (const r of resultados) if (r.status === "rejected") logger.error({ err: r.reason }, "nao foi possivel enviar o aviso do disco");
  if (enviados === 0) return { enviado: false, motivo: "falha no envio", destinatarios: 0 };
  return { enviado: true, destinatarios: enviados };
}

/** O registro no Sentry (sem DSN não faz nada). */
export function registrarDiscoNoSentry(tipo: "atencao" | "critico", numeros: NumerosDoAviso): void {
  try {
    Sentry.captureMessage(textosAvisoDeDisco.sentry(tipo, numeros), { level: tipo === "critico" ? "error" : "warning", tags: { alarme: "disco", nivel: tipo } });
  } catch (erro) {
    logger.warn({ err: erro }, "disco: nao foi possivel registrar no Sentry");
  }
}
