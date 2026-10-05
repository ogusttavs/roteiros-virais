/**
 * "Tema do dia só para quem usa" (decisão do Gustavo, 05/10/2026), contra o Postgres real: o critério dos 3 dias (marca com roteiro há 2 dias conta; há 4 dias não; marca inativa
 * não conta; o ramo alternativo conta), a rodada da madrugada só pelos setores em uso (com o resumo "sem uso"), quem pede à mão ou abre a tela passando por cima do critério, e o
 * pedido do tema na hora quando alguém abre o Criar (um pedido por setor, nunca onde o setor já tentou hoje).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, ramosDaConta, roteiros, temasDia } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { DIAS_DE_USO_PARA_TEMA, MOTIVO_SEM_USO, rodarTemasDoDia, setoresEmUso } from "@/jobs/temas-do-dia";
import { hojeISO } from "@/lib/config";
import { pedirTemaDeHoje } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 24 * 60 * 60 * 1000;
let recente: number;
let antigo: number;
let inativo: number;
let alternativo: number;
let semMarca: number;

async function roteiroHaDias(clienteId: number, dias: number) {
  await db().insert(roteiros).values({
    clienteId,
    data: hojeISO(),
    tema: "t",
    origem: "livre",
    objetivo: "reconhecimento",
    conteudo: { gancho: "g", corpo: "c", fechamento: "f", chamadaFinal: "x" },
    criadoEm: new Date(Date.now() - dias * DIA),
  } as never);
}

beforeAll(async () => {
  await resetarSchema(db());
  const novo = async (slug: string) => (await db().insert(nichos).values({ slug, nome: slug, termos: [] }).returning())[0].id;
  recente = await novo("uso-recente");
  antigo = await novo("uso-antigo");
  inativo = await novo("uso-marca-inativa");
  alternativo = await novo("uso-alternativo");
  semMarca = await novo("uso-sem-marca");

  const [a] = await db().insert(clientes).values({ nome: "Marca recente", nichoId: recente }).returning();
  await roteiroHaDias(a.id, 2);
  const [b] = await db().insert(clientes).values({ nome: "Marca antiga", nichoId: antigo }).returning();
  await roteiroHaDias(b.id, 4);
  const [c] = await db().insert(clientes).values({ nome: "Marca inativa", nichoId: inativo, ativo: false }).returning();
  await roteiroHaDias(c.id, 1);
  // A marca com roteiro recente também usa o ramo alternativo dela.
  await db().insert(ramosDaConta).values({ clienteId: a.id, nichoId: alternativo });
}, 60_000);

afterAll(async () => {
  await garantirBossPronto();
  await boss().deleteAllJobs(FILAS.temasDoDia).catch(() => undefined);
  await boss().stop({ graceful: false, timeout: 1 }).catch(() => undefined);
  await getPool().end();
});

describe("setoresEmUso", () => {
  it(`marca com roteiro nos últimos ${DIAS_DE_USO_PARA_TEMA} dias conta; mais velho, marca inativa e setor sem marca não; o ramo alternativo da marca em uso conta`, async () => {
    const emUso = await setoresEmUso();
    expect(emUso.has(recente)).toBe(true);
    expect(emUso.has(alternativo)).toBe(true);
    expect(emUso.has(antigo)).toBe(false);
    expect(emUso.has(inativo)).toBe(false);
    expect(emUso.has(semMarca)).toBe(false);
  });

  it("o relógio é injetável: daqui a 2 dias a marca de 2 dias já não conta", async () => {
    const emUso = await setoresEmUso(new Date(Date.now() + 2 * DIA));
    expect(emUso.has(recente)).toBe(false);
  });
});

describe("rodarTemasDoDia: a madrugada só para quem usa", () => {
  it("só os setores em uso entram, e o resumo diz quantos ficaram sem uso e por quê", async () => {
    const resumo = await rodarTemasDoDia();
    // Em uso: o recente e o alternativo (2); sem uso: os outros três.
    expect(resumo.nichos).toBe(2);
    expect(resumo.semUso).toBe(3);
    expect(resumo.motivoSemUso).toBe(MOTIVO_SEM_USO);
  });

  it("um setor sem uso chamado pelo nichoId (o tema imediato da cadeia de análise) também fica de fora", async () => {
    const resumo = await rodarTemasDoDia(semMarca);
    expect(resumo).toMatchObject({ nichos: 0, semUso: 1 });
  });

  it("quem pede à mão (forcar) ou quem abriu a tela (aoAbrir) passa por cima do critério", async () => {
    expect(await rodarTemasDoDia(semMarca, { forcar: true })).toMatchObject({ nichos: 1, semUso: 0 });
    expect(await rodarTemasDoDia(antigo, { aoAbrir: true })).toMatchObject({ nichos: 1, semUso: 0 });
  });
});

describe("pedirTemaDeHoje: o tema nasce na hora para quem abre a tela", () => {
  it("sem tema hoje: pede (gerando), e um segundo pedido não empilha outro; com a linha de hoje (até a vazia) não pede", async () => {
    await db().delete(temasDia).where(eq(temasDia.nichoId, semMarca));
    expect(await pedirTemaDeHoje(semMarca)).toBe("gerando");
    expect(await pedirTemaDeHoje(semMarca)).toBe("gerando");
    const pendentes = await db().execute(
      sql`select data from pgboss.job where name = ${FILAS.temasDoDia} and (data ->> 'nichoId')::int = ${semMarca} and state in ('created', 'retry', 'active')`,
    );
    expect(pendentes.rows).toHaveLength(1);
    expect((pendentes.rows[0] as { data: { aoAbrir: boolean } }).data.aoAbrir).toBe(true);

    await db().insert(temasDia).values({ nichoId: antigo, data: hojeISO(), temas: [] });
    expect(await pedirTemaDeHoje(antigo)).toBe("nao");
  });
});
