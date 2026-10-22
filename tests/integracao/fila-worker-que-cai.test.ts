/**
 * O worker que cai (achado do ensaio do Compose de produção, 22/10/2026): depois de matar o processo do
 * worker, a `coleta-noticias` disparada não terminava, e o ensaio via "nenhum". Duas causas provadas aqui,
 * contra o pg-boss de verdade:
 *
 * 1. O disparo usava `singletonSeconds: 30`, uma janela alinhada ao relógio: um job que já tinha terminado
 *    ocupava a janela e o disparo seguinte, dentro dos mesmos 30 segundos, voltava 202 "duplicado" sem enfileirar.
 * 2. Um job `active` de um worker morto fica `active` até o prazo da fila (4 horas), e o disparo recusa
 *    enquanto houver um `active` do mesmo nome.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { execucoesJob } from "@/db/schema";
import { enfileirarSemDuplicar } from "@/jobs/disparo";
import { boss, existeJobPendente, FILAS, garantirFilas, opcoesDaFila, PULSO_DO_WORKER_S } from "@/jobs/fila";
import { MOTIVO_ORFAO, recolherOrfaosDoWorkerAnterior } from "@/jobs/orfaos";

import { resetarSchema } from "../../scripts/resetar-schema";

const LONGA = FILAS.coletaNoticias;
const CURTA = FILAS.faxinaVersoes;

async function estadoDoJob(nome: string, id: string): Promise<string | undefined> {
  const { rows } = await db().execute<{ state: string }>(sql`select state from pgboss.job where name = ${nome} and id = ${id}`);
  return rows[0]?.state;
}

async function limpar(): Promise<void> {
  await boss().deleteAllJobs(LONGA);
  await boss().deleteAllJobs(CURTA);
  await db().delete(execucoesJob);
}

beforeAll(async () => {
  await resetarSchema(db());
  await boss().start();
  await garantirFilas();
}, 60_000);

beforeEach(limpar);

afterAll(async () => {
  await limpar().catch(() => undefined);
  await boss().stop({ graceful: false, timeout: 1 }).catch(() => undefined);
  await getPool().end();
});

describe("o disparo não tem janela de tempo", () => {
  it("um job que já terminou não impede o próximo disparo, no mesmo segundo", async () => {
    const primeiro = await enfileirarSemDuplicar(LONGA);
    expect(primeiro).toEqual(expect.any(String));
    const [job] = await boss().fetch(LONGA);
    await boss().complete(LONGA, job.id);
    expect(await estadoDoJob(LONGA, primeiro!)).toBe("completed");

    const segundo = await enfileirarSemDuplicar(LONGA);
    expect(segundo).toEqual(expect.any(String));
    expect(segundo).not.toBe(primeiro);
  });

  it("enquanto há um na fila ou rodando, não entra outro (com e sem ramo)", async () => {
    const primeiro = await enfileirarSemDuplicar(LONGA);
    expect(primeiro).toEqual(expect.any(String));
    expect(await enfileirarSemDuplicar(LONGA)).toBeNull();

    await boss().fetch(LONGA); // agora está `active`
    expect(await enfileirarSemDuplicar(LONGA)).toBeNull();

    // Um disparo de um ramo só não é bloqueado pelo "todos os ramos", e vice-versa (a regra de sempre).
    const { rows } = await db().execute<{ id: number }>(sql`insert into nichos (slug, nome, termos) values ('fw-a', 'fw-a', '{}') returning id`);
    const ramo = rows[0].id;
    expect(await enfileirarSemDuplicar(LONGA, ramo)).toEqual(expect.any(String));
    expect(await enfileirarSemDuplicar(LONGA, ramo)).toBeNull();
  });

  it("dois pedidos no mesmo instante viram um job só", async () => {
    const resultados = await Promise.all(Array.from({ length: 6 }, () => enfileirarSemDuplicar(LONGA)));
    expect(resultados.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("o worker que sobe recolhe o que o anterior deixou", () => {
  it("job ativo de um worker morto trava o disparo; ao subir, o novo worker o dá como falho e o próximo disparo entra", async () => {
    const orfao = await enfileirarSemDuplicar(LONGA);
    const [ativo] = await boss().fetch(LONGA); // o worker "morreu" com o job `active`
    expect(ativo.id).toBe(orfao);
    expect(await existeJobPendente(LONGA)).toBe(true);
    expect(await enfileirarSemDuplicar(LONGA)).toBeNull(); // o sintoma do ensaio

    const recolhidos = await recolherOrfaosDoWorkerAnterior();

    expect(recolhidos.jobs).toBe(1);
    expect(await estadoDoJob(LONGA, orfao!)).toBe("failed"); // fila longa: sem repetição à força
    expect(await existeJobPendente(LONGA)).toBe(false);
    expect(await enfileirarSemDuplicar(LONGA)).toEqual(expect.any(String));
  });

  it("fila curta: o job órfão volta para a repetição da própria fila, sem rodar junto com ninguém", async () => {
    const id = await boss().send(CURTA);
    await boss().fetch(CURTA);

    await recolherOrfaosDoWorkerAnterior();

    expect(await estadoDoJob(CURTA, id!)).toBe("retry");
  });

  it("não mexe no que está na fila nem no que já terminou", async () => {
    const naFila = await boss().send(LONGA);
    const feito = await boss().send(CURTA);
    const [j] = await boss().fetch(CURTA);
    await boss().complete(CURTA, j.id);

    const recolhidos = await recolherOrfaosDoWorkerAnterior();

    expect(recolhidos.jobs).toBe(0);
    expect(await estadoDoJob(LONGA, naFila!)).toBe("created");
    expect(await estadoDoJob(CURTA, feito!)).toBe("completed");
  });

  it("a execução que ficou 'rodando' vira erro com o motivo; a que terminou fica como estava", async () => {
    const [presa] = await db().insert(execucoesJob).values({ nome: LONGA, status: "rodando" }).returning();
    const [boa] = await db().insert(execucoesJob).values({ nome: LONGA, status: "ok", terminadoEm: new Date() }).returning();

    const recolhidos = await recolherOrfaosDoWorkerAnterior();

    expect(recolhidos.execucoes).toBe(1);
    const [depoisPresa] = await db().select().from(execucoesJob).where(eq(execucoesJob.id, presa.id));
    expect(depoisPresa.status).toBe("erro");
    expect(depoisPresa.erro).toBe(MOTIVO_ORFAO);
    expect(depoisPresa.terminadoEm).not.toBeNull();
    const [depoisBoa] = await db().select().from(execucoesJob).where(eq(execucoesJob.id, boa.id));
    expect(depoisBoa.status).toBe("ok");
  });
});

describe("o pulso do worker (segunda rede, para o worker que fica fora do ar)", () => {
  it("toda fila nasce com o pulso, e o job criado herda", async () => {
    for (const nome of Object.values(FILAS)) {
      expect((await boss().getQueue(nome))?.heartbeatSeconds).toBe(PULSO_DO_WORKER_S);
      expect(opcoesDaFila(nome).heartbeatSeconds).toBe(PULSO_DO_WORKER_S);
    }
    const id = await boss().send(LONGA);
    const { rows } = await db().execute<{ heartbeat_seconds: number }>(sql`select heartbeat_seconds from pgboss.job where id = ${id}`);
    expect(rows[0].heartbeat_seconds).toBe(PULSO_DO_WORKER_S);
  });

  it("sem pulso por mais que o prazo, o monitor do pg-boss dá o job como falho e o disparo volta a entrar", async () => {
    const id = await boss().send(LONGA);
    await boss().fetch(LONGA);
    expect(await enfileirarSemDuplicar(LONGA)).toBeNull();

    // O worker morreu há 10 minutos: o último pulso é antigo.
    await db().execute(sql`update pgboss.job set heartbeat_on = now() - interval '10 minutes' where id = ${id}`);
    await boss().supervise(LONGA);

    expect(await estadoDoJob(LONGA, id!)).toBe("failed");
    expect(await enfileirarSemDuplicar(LONGA)).toEqual(expect.any(String));
  });

  it("com pulso recente, o monitor não toca num job que está rodando de verdade", async () => {
    const id = await boss().send(LONGA);
    await boss().fetch(LONGA);
    await db().execute(sql`update pgboss.job set heartbeat_on = now() - interval '60 seconds' where id = ${id}`);

    await boss().supervise(LONGA);

    expect(await estadoDoJob(LONGA, id!)).toBe("active");
  });
});
