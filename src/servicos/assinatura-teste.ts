/**
 * E22, o teste grátis: o e-mail de 2 dias antes do fim do teste (decisão do Gustavo em 28/10/2026, pedido na ordem do teste de 7 dias). Roda de hora em hora no job `lembrete-fim-do-teste`
 * e só age entre 8h e 20h de Brasília (nenhum e-mail de madrugada). Escolhe as assinaturas `trialing` que ainda não pediram cancelamento, cujo teste acaba nas próximas 48 horas e que ainda
 * não receberam o aviso, e manda ao dono da conta.
 *
 * Mesma ordem do lembrete diário e do aviso do Instagram: marca `lembrete_fim_do_teste_em` ANTES de enviar (se o processo cair no meio, não manda duas vezes) e desfaz se o envio falhar
 * (na próxima hora, tenta de novo). Não depende do aviso `customer.subscription.trial_will_end` do Stripe: o horário dele (3 dias antes) não é o combinado, e um e-mail que dependesse de
 * um aviso configurado à mão no painel do Stripe poderia nunca sair.
 */
import { and, eq, gt, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { assinaturas, clientes, membrosMarca, user } from "@/db/schema";
import { config, horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { textosAssinatura } from "@/textos/assinatura";

/** Com quanto tempo de antecedência o aviso sai: 2 dias. */
export const ANTECEDENCIA_DO_AVISO_DO_TESTE_MS = 2 * 24 * 60 * 60 * 1000;
/** A janela do dia em que o e-mail pode sair (hora de Brasília, inclusive nas duas pontas). */
const HORA_MINIMA = 8;
const HORA_MAXIMA = 20;

export type ResumoDoAvisoDoTeste = { candidatas: number; avisadas: number; semDono: number; falhas: number; foraDoHorario: boolean };

export async function avisarFimDoTeste(agora: Date = new Date(), enviar: typeof enviarEmail = enviarEmail): Promise<ResumoDoAvisoDoTeste> {
  const resumo: ResumoDoAvisoDoTeste = { candidatas: 0, avisadas: 0, semDono: 0, falhas: 0, foraDoHorario: false };
  const hora = Number(horaAtualISO(agora).slice(0, 2));
  if (hora < HORA_MINIMA || hora > HORA_MAXIMA) {
    resumo.foraDoHorario = true;
    return resumo;
  }

  const candidatas = await db()
    .select({ id: assinaturas.id, clienteId: assinaturas.clienteId, periodoFim: assinaturas.periodoFim })
    .from(assinaturas)
    .where(
      and(
        eq(assinaturas.status, "trialing"),
        eq(assinaturas.cancelaNoFimDoPeriodo, false),
        isNull(assinaturas.lembreteFimDoTesteEm),
        gt(assinaturas.periodoFim, agora),
        lte(assinaturas.periodoFim, new Date(agora.getTime() + ANTECEDENCIA_DO_AVISO_DO_TESTE_MS)),
      ),
    );
  resumo.candidatas = candidatas.length;

  for (const candidata of candidatas) {
    const fim = candidata.periodoFim;
    if (!fim) continue;
    const donos = await db()
      .select({ email: user.email, nomeDaMarca: clientes.nome })
      .from(membrosMarca)
      .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
      .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
      .where(and(eq(membrosMarca.clienteId, candidata.clienteId), eq(membrosMarca.papel, "dono")));
    if (donos.length === 0) {
      resumo.semDono += 1;
      continue;
    }
    // Marca antes de enviar; quem ganhar a corrida (duas execuções ao mesmo tempo) é o único que envia.
    const [reservada] = await db()
      .update(assinaturas)
      .set({ lembreteFimDoTesteEm: agora })
      .where(and(eq(assinaturas.id, candidata.id), isNull(assinaturas.lembreteFimDoTesteEm)))
      .returning({ id: assinaturas.id });
    if (!reservada) continue;

    const resultados = await Promise.allSettled(
      donos.map((dono) =>
        enviar({
          para: dono.email,
          assunto: textosAssinatura.emailFimDoTeste.assunto,
          html: textosAssinatura.emailFimDoTeste.corpo(dono.nomeDaMarca, fim, config.cobranca.testeExigeCartao),
        }),
      ),
    );
    for (const r of resultados) if (r.status === "rejected") logger.error({ err: r.reason, clienteId: candidata.clienteId }, "assinatura: o aviso do fim do teste gratis nao saiu");
    if (resultados.some((r) => r.status === "fulfilled")) {
      resumo.avisadas += 1;
    } else {
      await db().update(assinaturas).set({ lembreteFimDoTesteEm: null }).where(eq(assinaturas.id, candidata.id));
      resumo.falhas += 1;
    }
  }
  return resumo;
}
