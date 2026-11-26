/**
 * O e-mail para o admin quando a IA está trancada pela chave recusada ou pela falta de crédito (achado B1 da revisão de 23/11/2026).
 *
 * Gatilho: `registrarFalhaDaIA` (`src/ia/falha-da-ia.ts`), o ponto único em que toda falha dessas causas passa, seja numa tela do cliente, no worker ou no job da madrugada. Foi escolhido em vez de um job
 * próprio porque não depende de ninguém lembrar de agendar nada e avisa na primeira falha, não na próxima rodada.
 *
 * "Uma vez por dia": a trava é uma linha de `configuracao_admin` por causa, e é TOMADA antes de enviar, num `INSERT ... ON CONFLICT ... WHERE` atômico. Várias falhas ao mesmo tempo (os temas de vários setores
 * falham juntos) disputam a linha e só uma ganha, então ninguém recebe o aviso em dobro. Se nenhum envio chegar a sair, a trava volta ao valor de antes e a próxima falha tenta de novo.
 * Destinatários: os mesmos de `avisarLeituraParada` (`destinatariosDoAviso`).
 *
 * Achado A4 da auditoria de 26/11/2026: o mesmo alarme avisa quando uma marca passa do freio de gasto da IA (`avisarFreioDeGasto`, chamado por `src/ia/freio.ts`), com a mesma trava, uma linha por marca.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { textosAvisoDaIA, type FalhaParaOAviso } from "@/textos/aviso-ia";
import { textosFreioDaIA, type FreioParaOAviso } from "@/textos/freio-ia";

import { destinatariosDoAviso } from "./aviso-de-leitura";

export const chaveDoAvisoDaIA = (causa: FalhaParaOAviso["causa"]) => `aviso_ia_${causa}_enviado_em`;

export type ResultadoDoAvisoDaIA = { enviado: boolean; motivo?: "ja enviado hoje" | "sem destinatario" | "falha no envio"; destinatarios?: number };

export async function avisarFalhaDaIA(
  falha: FalhaParaOAviso,
  agora: Date = new Date(),
  enviar: typeof enviarEmail = enviarEmail,
): Promise<ResultadoDoAvisoDaIA> {
  return avisarUmaVezPorDia({
    chave: chaveDoAvisoDaIA(falha.causa),
    agora,
    enviar,
    assunto: () => textosAvisoDaIA.assunto(falha),
    html: () => textosAvisoDaIA.corpo(falha, `${config.appUrl}/admin`),
    semDestinatario: () => logger.warn({ causa: falha.causa }, "a IA esta trancada, mas nao ha admin nem EMAIL_ACOMPANHAMENTO para receber o aviso"),
    falhaNoEnvio: (erro) => logger.error({ err: erro }, "nao foi possivel enviar o aviso da falha da IA"),
  });
}

/** Achado A4 da auditoria de 26/11/2026: uma linha por marca, para a marca que passa do freio hoje não calar o aviso de outra. */
export const chaveDoAvisoDoFreio = (clienteId: number) => `aviso_ia_freio_${clienteId}_enviado_em`;

/**
 * O e-mail do alarme da IA quando uma marca passa do freio de gasto (`src/ia/freio.ts`). Mesmo caminho e mesma trava do aviso da IA trancada: os mesmos destinatários, no máximo um por dia,
 * só que por marca (o freio é de uma marca, não da IA inteira).
 */
export async function avisarFreioDeGasto(
  freio: FreioParaOAviso,
  agora: Date = new Date(),
  enviar: typeof enviarEmail = enviarEmail,
): Promise<ResultadoDoAvisoDaIA> {
  return avisarUmaVezPorDia({
    chave: chaveDoAvisoDoFreio(freio.clienteId),
    agora,
    enviar,
    assunto: () => textosFreioDaIA.aviso.assunto(freio),
    html: () => textosFreioDaIA.aviso.corpo(freio, `${config.appUrl}/admin/clientes/${freio.clienteId}`),
    semDestinatario: () => logger.warn({ clienteId: freio.clienteId }, "uma marca passou do freio de gasto da IA, mas nao ha admin nem EMAIL_ACOMPANHAMENTO para receber o aviso"),
    falhaNoEnvio: (erro) => logger.error({ err: erro, clienteId: freio.clienteId }, "nao foi possivel enviar o aviso do freio de gasto da IA"),
  });
}

/** A trava de "um por dia" e o envio, iguais para os dois avisos (descritos no alto do arquivo). */
async function avisarUmaVezPorDia(aviso: {
  chave: string;
  agora: Date;
  enviar: typeof enviarEmail;
  assunto: () => string;
  html: () => string;
  semDestinatario: () => void;
  falhaNoEnvio: (erro: unknown) => void;
}): Promise<ResultadoDoAvisoDaIA> {
  const { chave } = aviso;
  const hoje = hojeISO(aviso.agora);

  // Guarda o que havia, para devolver se o envio falhar por inteiro.
  const [antes] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chave));
  if (antes?.valor === hoje) return { enviado: false, motivo: "ja enviado hoje" };

  const para = await destinatariosDoAviso();
  if (para.length === 0) {
    aviso.semDestinatario();
    return { enviado: false, motivo: "sem destinatario" };
  }

  // Tomar o dia: só quem muda a linha de "outro dia" para hoje segue adiante.
  const tomou = await db()
    .insert(configuracaoAdmin)
    .values({ chave, valor: hoje })
    .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor: hoje, atualizadoEm: new Date() }, setWhere: sql`${configuracaoAdmin.valor} <> ${hoje}` })
    .returning({ chave: configuracaoAdmin.chave });
  if (tomou.length === 0) return { enviado: false, motivo: "ja enviado hoje" };

  const assunto = aviso.assunto();
  const html = aviso.html();
  const resultados = await Promise.allSettled(para.map((email) => aviso.enviar({ para: email, assunto, html })));
  const enviados = resultados.filter((r) => r.status === "fulfilled").length;
  for (const r of resultados) if (r.status === "rejected") aviso.falhaNoEnvio(r.reason);

  if (enviados === 0) {
    // Nada saiu: devolve a trava para a próxima falha tentar de novo.
    if (antes) await db().update(configuracaoAdmin).set({ valor: antes.valor }).where(eq(configuracaoAdmin.chave, chave));
    else await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chave));
    return { enviado: false, motivo: "falha no envio", destinatarios: 0 };
  }
  return { enviado: true, destinatarios: enviados };
}
