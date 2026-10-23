/**
 * O custo do filtro das notícias dia a dia, para a aba Custos (revisão do Fable de 22/10/2026, item 12), contra o Postgres real: agrupa por dia do Brasil, conta os ramos, deixa de fora
 * outras tarefas e o que passou de 7 dias.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { geracoesIA, nichos } from "@/db/schema";
import { custoDoFiltroDeNoticias } from "@/servicos/custo-do-filtro-de-noticias";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date("2026-10-22T15:00:00Z"); // 12h em Brasília
let ramoA: number;
let ramoB: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "filtro-custo-a", nome: "Odontologia", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "filtro-custo-b", nome: "Limpeza", termos: [] }).returning();
  ramoA = a.id;
  ramoB = b.id;
}, 60_000);

beforeEach(async () => {
  await db().delete(geracoesIA);
});

afterAll(async () => {
  await getPool().end();
});

async function geracao(tarefa: string, ramoId: number, usd: string, quando: string) {
  await db()
    .insert(geracoesIA)
    .values({ tarefa, versaoPrompt: "1.0.0", modelo: "mock", entradas: {}, ramoId, custoUsd: usd, criadoEm: new Date(quando) } as never);
}

describe("custoDoFiltroDeNoticias", () => {
  it("sem nenhuma chamada, sem dias e sem média", async () => {
    const c = await custoDoFiltroDeNoticias(AGORA);
    expect(c).toEqual({ dias: [], totalUsd: 0, totalChamadas: 0, usdPorRamoPorDia: null, chamadasPorRamoPorDia: null });
  });

  it("agrupa por dia no Brasil, conta os ramos e a média por ramo por dia; outras tarefas e mais de 7 dias ficam de fora", async () => {
    // hoje (22/10): 3 chamadas, 2 ramos
    await geracao("filtrarNoticias", ramoA, "0.010000", "2026-10-22T10:00:00Z");
    await geracao("filtrarNoticias", ramoA, "0.010000", "2026-10-22T13:00:00Z");
    await geracao("filtrarNoticias", ramoB, "0.020000", "2026-10-22T14:00:00Z");
    // 02:00 UTC de 22/10 ainda é 23:00 de 21/10 no Brasil
    await geracao("filtrarNoticias", ramoA, "0.040000", "2026-10-22T02:00:00Z");
    // 7 dias atrás cai fora (a janela é de hoje e os 6 dias anteriores: de 16/10 em diante)
    await geracao("filtrarNoticias", ramoA, "0.500000", "2026-10-15T15:00:00Z");
    await geracao("filtrarNoticias", ramoA, "0.030000", "2026-10-16T15:00:00Z");
    // outra tarefa não conta
    await geracao("temasDoDia", ramoA, "0.900000", "2026-10-22T11:00:00Z");

    const c = await custoDoFiltroDeNoticias(AGORA);
    expect(c.dias.map((d) => d.dia)).toEqual(["2026-10-22", "2026-10-21", "2026-10-16"]);
    expect(c.dias[0]).toMatchObject({ chamadas: 3, ramos: 2 });
    expect(c.dias[0].usd).toBeCloseTo(0.04, 6);
    expect(c.dias[1]).toMatchObject({ chamadas: 1, ramos: 1 });
    expect(c.totalChamadas).toBe(5);
    expect(c.totalUsd).toBeCloseTo(0.11, 6);
    // ramo-dias: 2 + 1 + 1 = 4
    expect(c.usdPorRamoPorDia).toBeCloseTo(0.11 / 4, 6);
    expect(c.chamadasPorRamoPorDia).toBeCloseTo(5 / 4, 6);
  });
});
