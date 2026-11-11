/**
 * O aviso ao admin quando uma conta bate o teto de gasto de IA da edição de vídeo no mês (achado 5 da revisão de 03/11/2026), pelo mesmo caminho dos outros avisos: e-mail para os admins (e o
 * `EMAIL_ACOMPANHAMENTO`) pela Resend. Uma vez por conta por mês: a trava é uma linha de `configuracao_admin` (sem tabela nova) gravada ANTES de enviar, com `ON CONFLICT DO NOTHING`, então duas
 * recusas ao mesmo tempo mandam um e-mail só; se o envio falha para todos, a linha sai e a próxima recusa tenta de novo. A linha no Início do admin vem da conta feita em `admin-inicio.ts`.
 * Falha de envio nunca derruba a recusa que a pessoa vê.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { textosAvisoDoTetoDaEdicao, type NumerosDoTeto } from "@/textos/aviso-teto-edicao";

import { destinatariosDoAviso } from "./aviso-de-leitura";

export type ResultadoDoAvisoDoTeto = { enviado: boolean; motivo?: "ja avisado neste mes" | "sem destinatario" | "falha no envio"; destinatarios?: number };

/** A chave de `configuracao_admin` do aviso desta conta neste mês de Brasília (`mes` é "AAAA-MM"). */
export function chaveDoAvisoDoTeto(clienteId: number, mes: string): string {
  return `aviso_teto_edicao:${clienteId}:${mes}`;
}

export async function avisarTetoDaEdicao(clienteId: number, numeros: NumerosDoTeto, mes: string, agora: Date = new Date(), enviar: typeof enviarEmail = enviarEmail): Promise<ResultadoDoAvisoDoTeto> {
  const chave = chaveDoAvisoDoTeto(clienteId, mes);
  const [reservado] = await db().insert(configuracaoAdmin).values({ chave, valor: hojeISO(agora) }).onConflictDoNothing().returning({ chave: configuracaoAdmin.chave });
  if (!reservado) return { enviado: false, motivo: "ja avisado neste mes" };

  const soltar = () => db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chave));
  const para = await destinatariosDoAviso();
  if (para.length === 0) {
    logger.warn({ clienteId }, "teto da edicao: a conta chegou ao teto, mas nao ha admin nem EMAIL_ACOMPANHAMENTO para receber o aviso");
    await soltar();
    return { enviado: false, motivo: "sem destinatario" };
  }
  const assunto = textosAvisoDoTetoDaEdicao.assunto(numeros);
  const html = textosAvisoDoTetoDaEdicao.corpo(numeros, `${config.appUrl}/admin`);
  const resultados = await Promise.allSettled(para.map((email) => enviar({ para: email, assunto, html })));
  const enviados = resultados.filter((r) => r.status === "fulfilled").length;
  for (const r of resultados) if (r.status === "rejected") logger.error({ err: r.reason }, "nao foi possivel enviar o aviso do teto da edicao");
  if (enviados === 0) {
    await soltar();
    return { enviado: false, motivo: "falha no envio", destinatarios: 0 };
  }
  return { enviado: true, destinatarios: enviados };
}
