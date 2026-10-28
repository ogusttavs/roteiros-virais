/**
 * "Tema do dia só para quem usa" (decisão do Gustavo, 05/10/2026; em 27/10/2026 passou a contar acesso ao aplicativo, não roteiro gerado, numa janela de 5 dias), contra o Postgres real:
 * marca aberta há 4 dias gera, há 6 dias pausa; roteiro gerado sem abrir o aplicativo não conta; marca inativa não conta; o ramo alternativo conta; a rodada da madrugada só pelos
 * setores em uso (com o resumo "sem uso"); quem pede à mão ou abre a tela passa por cima do critério; e a pessoa que volta depois da pausa dispara a geração uma vez só.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, ramosDaConta, roteiros, temasDia } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { DIAS_DE_USO_PARA_TEMA, MOTIVO_SEM_USO, rodarTemasDoDia, setoresEmUso } from "@/jobs/temas-do-dia";
import { hojeISO } from "@/lib/config";
import { registrarAcessoHoje } from "@/servicos/clientes";
import { pedirTemaDeHoje } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 24 * 60 * 60 * 1000;
let recente: number;
let quatroDias: number;
let seisDias: number;
let soRoteiro: number;
let inativo: number;
let alternativo: number;
let semMarca: number;
let marcaSeisDias: number;

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
  quatroDias = await novo("uso-4-dias");
  seisDias = await novo("uso-6-dias");
  soRoteiro = await novo("uso-so-roteiro");
  inativo = await novo("uso-marca-inativa");
  alternativo = await novo("uso-alternativo");
  semMarca = await novo("uso-sem-marca");

  const [a] = await db().insert(clientes).values({ nome: "Marca recente", nichoId: recente, ultimoAcessoEm: new Date(Date.now() - 1 * DIA) }).returning();
  await db().insert(clientes).values({ nome: "Marca de 4 dias", nichoId: quatroDias, ultimoAcessoEm: new Date(Date.now() - 4 * DIA) });
  const [f] = await db().insert(clientes).values({ nome: "Marca de 6 dias", nichoId: seisDias, ultimoAcessoEm: new Date(Date.now() - 6 * DIA) }).returning();
  marcaSeisDias = f.id;
  // Gerou roteiro ontem, mas ninguém abriu o aplicativo há 6 dias: o roteiro deixou de ser o critério. A outra marca nunca abriu, só gerou roteiro.
  await roteiroHaDias(f.id, 1);
  const [r] = await db().insert(clientes).values({ nome: "Marca só com roteiro", nichoId: soRoteiro }).returning();
  await roteiroHaDias(r.id, 1);
  await db().insert(clientes).values({ nome: "Marca inativa", nichoId: inativo, ativo: false, ultimoAcessoEm: new Date() });
  // A marca aberta recentemente também usa o ramo alternativo dela.
  await db().insert(ramosDaConta).values({ clienteId: a.id, nichoId: alternativo });
}, 60_000);

afterAll(async () => {
  await garantirBossPronto();
  await boss().deleteAllJobs(FILAS.temasDoDia).catch(() => undefined);
  await boss().stop({ graceful: false, timeout: 1 }).catch(() => undefined);
  await getPool().end();
});

describe("setoresEmUso", () => {
  it(`marca aberta há 4 dias conta (a janela é de ${DIAS_DE_USO_PARA_TEMA}); há 6 dias, com roteiro ou sem, não; marca inativa e setor sem marca não; o ramo alternativo conta`, async () => {
    expect(DIAS_DE_USO_PARA_TEMA).toBe(5);
    const emUso = await setoresEmUso();
    expect(emUso.has(recente)).toBe(true);
    expect(emUso.has(alternativo)).toBe(true);
    expect(emUso.has(quatroDias)).toBe(true);
    expect(emUso.has(seisDias)).toBe(false);
    expect(emUso.has(soRoteiro)).toBe(false);
    expect(emUso.has(inativo)).toBe(false);
    expect(emUso.has(semMarca)).toBe(false);
  });

  it("o relógio é injetável: daqui a 2 dias a marca de 4 dias passa a 6 e já não conta; a de 1 dia (passa a 3) continua", async () => {
    const emUso = await setoresEmUso(new Date(Date.now() + 2 * DIA));
    expect(emUso.has(quatroDias)).toBe(false);
    expect(emUso.has(recente)).toBe(true);
  });
});

describe("rodarTemasDoDia: a madrugada só para quem usa", () => {
  it("só os setores em uso entram, e o resumo diz quantos ficaram sem uso e por quê", async () => {
    const resumo = await rodarTemasDoDia();
    // Em uso: o recente, o de 4 dias e o alternativo (3); sem uso: os outros quatro.
    expect(resumo.nichos).toBe(3);
    expect(resumo.semUso).toBe(4);
    expect(resumo.motivoSemUso).toBe(MOTIVO_SEM_USO);
    expect(MOTIVO_SEM_USO).toBe("sem tema hoje: ninguém abriu o aplicativo em 5 dias");
  });

  it("um setor sem uso chamado pelo nichoId (o tema imediato da cadeia de análise) também fica de fora", async () => {
    const resumo = await rodarTemasDoDia(seisDias);
    expect(resumo).toMatchObject({ nichos: 0, semUso: 1 });
  });

  it("quem pede à mão (forcar) ou quem abriu a tela (aoAbrir) passa por cima do critério", async () => {
    expect(await rodarTemasDoDia(semMarca, { forcar: true })).toMatchObject({ nichos: 1, semUso: 0 });
    expect(await rodarTemasDoDia(seisDias, { aoAbrir: true })).toMatchObject({ nichos: 1, semUso: 0 });
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

    await db().insert(temasDia).values({ nichoId: quatroDias, data: hojeISO(), temas: [] });
    expect(await pedirTemaDeHoje(quatroDias)).toBe("nao");
  });
});

describe("a pessoa volta depois da pausa", () => {
  it("o ramo parado há 6 dias fica de fora; quando a pessoa abre o aplicativo ele volta a contar e o tema de hoje é pedido uma vez só", async () => {
    // Antes de voltar: pausado, e a madrugada não gera nada para ele.
    expect((await setoresEmUso()).has(seisDias)).toBe(false);
    await db().delete(temasDia).where(eq(temasDia.nichoId, seisDias));

    // A pessoa volta: o layout do painel grava o acesso (uma vez por dia) e a tela dos temas, sem tema de hoje, pede a geração.
    await registrarAcessoHoje("pessoa-que-voltou", marcaSeisDias);
    expect((await setoresEmUso()).has(seisDias)).toBe(true);

    expect(await pedirTemaDeHoje(seisDias)).toBe("gerando");
    // Ela atualiza a tela e abre de novo (a tela se atualiza sozinha a cada 5 segundos): nenhum segundo pedido.
    expect(await pedirTemaDeHoje(seisDias)).toBe("gerando");
    expect(await pedirTemaDeHoje(seisDias)).toBe("gerando");
    const pendentes = await db().execute(
      sql`select data from pgboss.job where name = ${FILAS.temasDoDia} and (data ->> 'nichoId')::int = ${seisDias} and state in ('created', 'retry', 'active')`,
    );
    expect(pendentes.rows).toHaveLength(1);
    expect((pendentes.rows[0] as { data: { aoAbrir: boolean } }).data.aoAbrir).toBe(true);
  });

  it("a tela que mostra o tema velho (o de ontem) pede o de hoje uma vez, e a linha de hoje (até a vazia) encerra os pedidos", async () => {
    await db().delete(temasDia).where(eq(temasDia.nichoId, soRoteiro));
    await boss().deleteAllJobs(FILAS.temasDoDia).catch(() => undefined);
    expect(await pedirTemaDeHoje(soRoteiro)).toBe("gerando");
    expect(await pedirTemaDeHoje(soRoteiro)).toBe("gerando");
    const pendentes = await db().execute(
      sql`select 1 from pgboss.job where name = ${FILAS.temasDoDia} and (data ->> 'nichoId')::int = ${soRoteiro} and state in ('created', 'retry', 'active')`,
    );
    expect(pendentes.rows).toHaveLength(1);
    await db().insert(temasDia).values({ nichoId: soRoteiro, data: hojeISO(), temas: [] });
    expect(await pedirTemaDeHoje(soRoteiro)).toBe("nao");
  });
});
