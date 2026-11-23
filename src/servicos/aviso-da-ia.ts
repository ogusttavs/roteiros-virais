/**
 * O e-mail para o admin quando a IA está trancada pela chave recusada ou pela falta de crédito (achado B1 da revisão de 23/11/2026).
 *
 * Gatilho: `registrarFalhaDaIA` (`src/ia/falha-da-ia.ts`), o ponto único em que toda falha dessas causas passa, seja numa tela do cliente, no worker ou no job da madrugada. Foi escolhido em vez de um job
 * próprio porque não depende de ninguém lembrar de agendar nada e avisa na primeira falha, não na próxima rodada.
 *
 * "Uma vez por dia": a trava é uma linha de `configuracao_admin` por causa, e é TOMADA antes de enviar, num `INSERT ... ON CONFLICT ... WHERE` atômico. Várias falhas ao mesmo tempo (os temas de vários setores
 * falham juntos) disputam a linha e só uma ganha, então ninguém recebe o aviso em dobro. Se nenhum envio chegar a sair, a trava volta ao valor de antes e a próxima falha tenta de novo.
 * Destinatários: os mesmos de `avisarLeituraParada` (`destinatariosDoAviso`).
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { textosAvisoDaIA, type FalhaParaOAviso } from "@/textos/aviso-ia";

import { destinatariosDoAviso } from "./aviso-de-leitura";

export const chaveDoAvisoDaIA = (causa: FalhaParaOAviso["causa"]) => `aviso_ia_${causa}_enviado_em`;

export type ResultadoDoAvisoDaIA = { enviado: boolean; motivo?: "ja enviado hoje" | "sem destinatario" | "falha no envio"; destinatarios?: number };

export async function avisarFalhaDaIA(
  falha: FalhaParaOAviso,
  agora: Date = new Date(),
  enviar: typeof enviarEmail = enviarEmail,
): Promise<ResultadoDoAvisoDaIA> {
  const chave = chaveDoAvisoDaIA(falha.causa);
  const hoje = hojeISO(agora);

  // Guarda o que havia, para devolver se o envio falhar por inteiro.
  const [antes] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chave));
  if (antes?.valor === hoje) return { enviado: false, motivo: "ja enviado hoje" };

  const para = await destinatariosDoAviso();
  if (para.length === 0) {
    logger.warn({ causa: falha.causa }, "a IA esta trancada, mas nao ha admin nem EMAIL_ACOMPANHAMENTO para receber o aviso");
    return { enviado: false, motivo: "sem destinatario" };
  }

  // Tomar o dia: só quem muda a linha de "outro dia" para hoje segue adiante.
  const tomou = await db()
    .insert(configuracaoAdmin)
    .values({ chave, valor: hoje })
    .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor: hoje, atualizadoEm: new Date() }, setWhere: sql`${configuracaoAdmin.valor} <> ${hoje}` })
    .returning({ chave: configuracaoAdmin.chave });
  if (tomou.length === 0) return { enviado: false, motivo: "ja enviado hoje" };

  const assunto = textosAvisoDaIA.assunto(falha);
  const html = textosAvisoDaIA.corpo(falha, `${config.appUrl}/admin`);
  const resultados = await Promise.allSettled(para.map((email) => enviar({ para: email, assunto, html })));
  const enviados = resultados.filter((r) => r.status === "fulfilled").length;
  for (const r of resultados) if (r.status === "rejected") logger.error({ err: r.reason }, "nao foi possivel enviar o aviso da falha da IA");

  if (enviados === 0) {
    // Nada saiu: devolve a trava para a próxima falha tentar de novo.
    if (antes) await db().update(configuracaoAdmin).set({ valor: antes.valor }).where(eq(configuracaoAdmin.chave, chave));
    else await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chave));
    return { enviado: false, motivo: "falha no envio", destinatarios: 0 };
  }
  return { enviado: true, destinatarios: enviados };
}
