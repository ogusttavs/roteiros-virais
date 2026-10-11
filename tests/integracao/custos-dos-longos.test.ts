/**
 * A E52 (PR 2), o que os vídeos longos custaram, para a aba Custos, contra o Postgres real: a transcrição pela Groq e o tráfego do proxy da rotina `ler-longos`, a leitura pela IA
 * e quantos longos foram lidos, por ramo, na janela de 30 dias. Os gastos de outras rotinas e de outras tarefas ficam de fora.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { custosExternos, execucoesJob, geracoesIA, nichos, videos } from "@/db/schema";
import { custosDosLongos } from "@/servicos/custos-dos-longos";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-11T15:00:00Z");

let ramoA: number;
let ramoB: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "custo-longos-a", nome: "Produtos de limpeza", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "custo-longos-b", nome: "Odontologia", termos: [] }).returning();
  ramoA = a.id;
  ramoB = b.id;
}, 60_000);

beforeEach(async () => {
  await db().delete(custosExternos);
  await db().delete(geracoesIA);
  await db().delete(videos);
  await db().delete(execucoesJob);
});

afterAll(async () => {
  await getPool().end();
});

async function execucao(nome: string, diasAtras = 1) {
  const [e] = await db()
    .insert(execucoesJob)
    .values({ nome, iniciadoEm: new Date(AGORA.getTime() - diasAtras * DIA_MS), status: "ok" })
    .returning();
  return e.id;
}

async function geracao(tarefa: string, ramoId: number, usd: string, diasAtras = 1) {
  await db()
    .insert(geracoesIA)
    .values({ tarefa, versaoPrompt: "1.0.0", modelo: "mock", entradas: {}, ramoId, custoUsd: usd, criadoEm: new Date(AGORA.getTime() - diasAtras * DIA_MS) } as never);
}

async function lido(idExterno: string, nichoId: number, diasAtras: number) {
  await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      duracaoS: 600,
      analiseLongaEm: new Date(AGORA.getTime() - diasAtras * DIA_MS),
    });
}

describe("custosDosLongos", () => {
  it("sem nenhuma rodada, tudo zerado e sem ramo", async () => {
    const c = await custosDosLongos(AGORA);
    expect(c).toMatchObject({ execucoes: 0, lidos: 0, minutos: 0, groqUsd: 0, proxyMb: 0, proxyUsd: 0, iaUsd: 0, chamadasDeIA: 0, totalUsd: 0, porRamo: [] });
  });

  it("soma a Groq, o proxy e a leitura da rotina dos longos, por ramo; o resto fica de fora", async () => {
    const dosLongos = await execucao("ler-longos");
    const doDiario = await execucao("transcrever");
    await db()
      .insert(custosExternos)
      .values([
        { fonte: "groq", custoUsd: "0.020000", unidades: "30.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: ramoA, execucaoId: dosLongos },
        { fonte: "groq", custoUsd: "0.010000", unidades: "15.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: ramoB, execucaoId: dosLongos },
        { fonte: "proxy", custoUsd: "0.001200", unidades: "12.000", unidade: "megabytes", origemDoCusto: "estimado", ramoId: ramoA, execucaoId: dosLongos },
        // a transcrição diária dos curtos não é dos longos
        { fonte: "groq", custoUsd: "0.500000", unidades: "700.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: ramoA, execucaoId: doDiario },
        // sem execução (a transcrição do momento da pessoa, por exemplo) também não
        { fonte: "groq", custoUsd: "0.400000", unidades: "500.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: ramoA, execucaoId: null },
      ]);
    await geracao("extrairVideoLongo", ramoA, "0.010000");
    await geracao("extrairVideoLongo", ramoA, "0.012000");
    await geracao("extrairVideoLongo", ramoB, "0.020000");
    // outra tarefa de IA do mesmo ramo, e uma leitura de 40 dias atrás
    await geracao("extrairVideo", ramoA, "0.300000");
    await geracao("extrairVideoLongo", ramoA, "0.900000", 40);

    await lido("lido-a1", ramoA, 2);
    await lido("lido-a2", ramoA, 5);
    await lido("lido-b1", ramoB, 3);
    await lido("lido-velho", ramoA, 40);

    const c = await custosDosLongos(AGORA);
    expect(c.execucoes).toBe(1);
    expect(c.lidos).toBe(3);
    expect(c.minutos).toBeCloseTo(45, 3);
    expect(c.groqUsd).toBeCloseTo(0.03, 6);
    expect(c.proxyMb).toBeCloseTo(12, 3);
    expect(c.proxyUsd).toBeCloseTo(0.0012, 6);
    expect(c.iaUsd).toBeCloseTo(0.042, 6);
    expect(c.chamadasDeIA).toBe(3);
    expect(c.totalUsd).toBeCloseTo(0.0732, 6);

    // por ramo, o que mais gastou primeiro
    expect(c.porRamo.map((r) => r.nome)).toEqual(["Produtos de limpeza", "Odontologia"]);
    const [a, b] = c.porRamo;
    expect(a).toMatchObject({ ramoId: ramoA, lidos: 2 });
    expect(a.minutos).toBeCloseTo(30, 3);
    expect(a.usd).toBeCloseTo(0.02 + 0.0012 + 0.022, 6);
    expect(b).toMatchObject({ ramoId: ramoB, lidos: 1 });
    expect(b.usd).toBeCloseTo(0.03, 6);
  });

  it("a rodada de mais de trinta dias não conta, nem o gasto dela", async () => {
    const velha = await execucao("ler-longos", 40);
    await db()
      .insert(custosExternos)
      .values({ fonte: "groq", custoUsd: "0.100000", unidades: "100.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: ramoA, execucaoId: velha, criadoEm: new Date(AGORA.getTime() - 40 * DIA_MS) });
    const c = await custosDosLongos(AGORA);
    expect(c.execucoes).toBe(0);
    expect(c.minutos).toBe(0);
    expect(c.totalUsd).toBe(0);
  });
});
