/**
 * O worker que sobe encontra restos do que morreu antes dele (22/10/2026). Só existe um worker (o serviço
 * `roteiros-worker` do Compose, e o Compose para o antigo antes de criar o novo), então, quando este
 * processo sobe, todo job `active` no banco e toda execução "rodando" são de um processo que já não existe.
 *
 * Sem isso, depois de um `kill -9` o job fica `active` até o `expireInSeconds` (4 horas nas filas longas):
 * `existeJobPendente` conta o `active` e o "rodar agora" recusa o disparo novo em silêncio, e o painel de
 * rotinas mostra "rodando" para sempre. O pulso do worker (`PULSO_DO_WORKER_S` em `fila.ts`) é a segunda
 * rede, para o caso de o processo cair e o Compose demorar a subir outro.
 *
 * O job órfão é dado como falho (`boss.fail`), nunca recolocado na fila à força: nas filas longas
 * `retryLimit` é 0 de propósito (cada repetição de uma coleta paga custa dinheiro, hotfix de 01/10/2026)
 * e a rodada seguinte do cron ou o próximo disparo é a nova tentativa; nas filas curtas o `fail` já
 * respeita as 2 repetições da fila. Como o processo antigo está morto, nunca há duas coletas iguais ao
 * mesmo tempo.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { execucoesJob } from "@/db/schema";

import { boss } from "./fila";

export const MOTIVO_ORFAO = "o worker caiu no meio desta execucao";

export type RecolhidosDoWorkerAnterior = { jobs: number; execucoes: number };

export async function recolherOrfaosDoWorkerAnterior(): Promise<RecolhidosDoWorkerAnterior> {
  const { rows } = await db().execute<{ id: string; name: string }>(sql`select id, name from pgboss.job where state = 'active'`);
  const porFila = new Map<string, string[]>();
  for (const { id, name } of rows) porFila.set(name, [...(porFila.get(name) ?? []), id]);
  for (const [fila, ids] of porFila) await boss().fail(fila, ids, { message: MOTIVO_ORFAO });

  const presas = await db()
    .update(execucoesJob)
    .set({ status: "erro", erro: MOTIVO_ORFAO, terminadoEm: new Date() })
    .where(eq(execucoesJob.status, "rodando"))
    .returning({ id: execucoesJob.id });

  return { jobs: rows.length, execucoes: presas.length };
}
