/**
 * O e-mail para o admin quando a leitura de uma rede está parada (23/10/2026). Quem chama é o fim do `transcrever` da madrugada, uma vez por noite; mesmo assim a trava de "uma vez por dia"
 * fica aqui, no banco (`configuracao_admin`, sem tabela nova), porque a rodada pode ser repetida à mão ou pelo pg-boss e o admin não pode receber o mesmo aviso duas vezes no mesmo dia.
 *
 * Destinatários: os admins do sistema (`user.role = 'admin'`, sem os banidos) mais o `EMAIL_ACOMPANHAMENTO`, se existir. A falha de e-mail nunca derruba a transcrição.
 */
import { and, eq, ne, or, isNull } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin, user } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { proxyEhTunel } from "@/lib/proxy-tunel";
import { textosAvisoDeLeitura } from "@/textos/aviso-leitura";

import { type EstadoDaLeitura, paradasEmLista } from "./leitura-parada";

/** A chave de `configuracao_admin` que guarda o dia (Brasil) do último aviso enviado. */
export const CHAVE_DO_AVISO_DE_LEITURA = "aviso_leitura_parada_enviado_em";

const DIA_MS = 24 * 60 * 60 * 1000;

export type ResultadoDoAviso = { enviado: boolean; motivo?: "nada parado" | "ja enviado hoje" | "sem destinatario" | "falha no envio"; destinatarios?: number };

export async function destinatariosDoAviso(): Promise<string[]> {
  const admins = await db()
    .select({ email: user.email })
    .from(user)
    .where(and(eq(user.role, "admin"), or(isNull(user.banned), ne(user.banned, true))));
  const emails = admins.map((a) => a.email.trim().toLowerCase());
  if (config.emailAcompanhamento) emails.push(config.emailAcompanhamento.trim().toLowerCase());
  return [...new Set(emails.filter((e) => e.length > 0))];
}

export async function avisarLeituraParada(
  estado: EstadoDaLeitura,
  agora: Date = new Date(),
  enviar: typeof enviarEmail = enviarEmail,
): Promise<ResultadoDoAviso> {
  const paradas = paradasEmLista(estado);
  if (paradas.length === 0) {
    // Tudo lê de novo: a próxima parada, mesmo no mesmo dia, merece um aviso novo.
    await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_AVISO_DE_LEITURA));
    return { enviado: false, motivo: "nada parado" };
  }

  const hoje = hojeISO(agora);
  const [ultimo] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_AVISO_DE_LEITURA));
  if (ultimo?.valor === hoje) return { enviado: false, motivo: "ja enviado hoje" };

  const para = await destinatariosDoAviso();
  if (para.length === 0) {
    logger.warn("leitura parada, mas nao ha admin nem EMAIL_ACOMPANHAMENTO para receber o aviso");
    return { enviado: false, motivo: "sem destinatario" };
  }

  const tunel = proxyEhTunel();
  const itens = paradas.map((p) => ({ ...p, proxyEhTunel: tunel, dias: Math.max(0, Math.floor((agora.getTime() - p.desde.getTime()) / DIA_MS)) }));
  const assunto = textosAvisoDeLeitura.assunto(itens);
  const html = textosAvisoDeLeitura.corpo(itens, `${config.appUrl}/admin`);
  const resultados = await Promise.allSettled(para.map((email) => enviar({ para: email, assunto, html })));
  const enviados = resultados.filter((r) => r.status === "fulfilled").length;
  for (const r of resultados) if (r.status === "rejected") logger.error({ err: r.reason }, "nao foi possivel enviar o aviso de leitura parada");
  if (enviados === 0) return { enviado: false, motivo: "falha no envio", destinatarios: 0 };

  await db()
    .insert(configuracaoAdmin)
    .values({ chave: CHAVE_DO_AVISO_DE_LEITURA, valor: hoje })
    .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor: hoje, atualizadoEm: new Date() } });
  return { enviado: true, destinatarios: enviados };
}
