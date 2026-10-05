/**
 * O custo que falta no admin, contra o Postgres real: o ramo em `execucoes_job` e em `geracoes_ia`, o custo da Groq e do Apify em `custos_externos`
 * (ligado à execução e ao ramo) e o que a página de Custos soma por ramo e fora da IA.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, custosExternos, execucoesJob, geracoesIA, nichos, videos } from "@/db/schema";
import { registrarGeracao } from "@/ia/registro";
import { definirRamoDoContexto, restaurarRamoDoContexto } from "@/jobs/contexto-execucao";
import { executarComRegistro } from "@/jobs/execucoes";
import { custosDoAdmin } from "@/servicos/admin-custos";
import { custoDaTranscricaoGroqUsd, registrarCustoExterno } from "@/servicos/custos-externos";

import { resetarSchema } from "../../scripts/resetar-schema";

const USO = { tokensEntrada: 1000, tokensSaida: 100, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };
let ramoA: number;
let ramoB: number;
let contaId: number;
let videoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "ck-a", nome: "Ramo A", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "ck-b", nome: "Ramo B", termos: [] }).returning();
  ramoA = a.id;
  ramoB = b.id;
  const [c] = await db().insert(clientes).values({ nome: "[teste] Conta do ramo B", nichoId: ramoB }).returning();
  contaId = c.id;
  const [v] = await db().insert(videos).values({ plataforma: "tiktok", idExterno: "ck-1", url: "https://exemplo.teste/ck-1", nichoId: ramoA } as never).returning();
  videoId = v.id;
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("o ramo na execução", () => {
  it("um job de um ramo grava o ramo; um job de todos grava nulo", async () => {
    await executarComRegistro("job-do-ramo", async () => ({}), { ramoId: ramoA });
    await executarComRegistro("job-de-todos", async () => ({}));
    const [doRamo] = await db().select().from(execucoesJob).where(eq(execucoesJob.nome, "job-do-ramo"));
    const [deTodos] = await db().select().from(execucoesJob).where(eq(execucoesJob.nome, "job-de-todos"));
    expect(doRamo.ramoId).toBe(ramoA);
    expect(deTodos.ramoId).toBeNull();
  });
});

describe("o ramo na geração", () => {
  async function ramoDe(id: number) {
    const [g] = await db().select({ ramoId: geracoesIA.ramoId }).from(geracoesIA).where(eq(geracoesIA.id, id));
    return g.ramoId;
  }
  const base = { versaoPrompt: "0", modelo: "mock", nivel: "barato" as const, uso: USO };

  it("o ramo dito por quem registra vale primeiro", async () => {
    const id = await registrarGeracao({ ...base, tarefa: "extrairVideo", entradas: {}, ramoId: ramoB });
    expect(await ramoDe(id)).toBe(ramoB);
  });

  it("senão o nichoId das entradas, senão o ramo do vídeo analisado", async () => {
    expect(await ramoDe(await registrarGeracao({ ...base, tarefa: "modeloNicho", entradas: { nichoId: ramoA } }))).toBe(ramoA);
    expect(await ramoDe(await registrarGeracao({ ...base, tarefa: "extrairVideo", entradas: { videoId } }))).toBe(ramoA);
  });

  it("senão o ramo da execução em andamento, senão o ramo da conta do cliente", async () => {
    let id = 0;
    await executarComRegistro(
      "job-de-ramo-b",
      async () => {
        id = await registrarGeracao({ ...base, tarefa: "classificarContaDoSetor", entradas: {} });
        return {};
      },
      { ramoId: ramoB },
    );
    expect(await ramoDe(id)).toBe(ramoB);
    expect(await ramoDe(await registrarGeracao({ ...base, tarefa: "roteiro", entradas: {}, clienteId: contaId }))).toBe(ramoB);
  });

  it("um nichoId que nao existe nas entradas nao derruba o registro: a geracao fica com ramo nulo", async () => {
    const id = await registrarGeracao({ ...base, tarefa: "modeloNicho", entradas: { nichoId: 987654 } });
    expect(await ramoDe(id)).toBeNull();
  });

  it("sem nenhuma pista, fica nulo", async () => {
    expect(await ramoDe(await registrarGeracao({ ...base, tarefa: "lerAgenda", entradas: { texto: "x" } }))).toBeNull();
  });
});

describe("o custo fora da IA", () => {
  it("fica ligado à execução e ao ramo; um job que percorre ramos vai trocando de ramo", async () => {
    let execucaoId = 0;
    await executarComRegistro("coleta-de-teste", async (id) => {
      execucaoId = id;
      definirRamoDoContexto(ramoA);
      await registrarCustoExterno({ fonte: "apify", custoUsd: 0.0123, unidades: 40, unidade: "resultados", origemDoCusto: "api", detalhe: { ator: "x" } });
      definirRamoDoContexto(ramoB);
      await registrarCustoExterno({ fonte: "groq", custoUsd: custoDaTranscricaoGroqUsd(120), unidades: 2, unidade: "minutos", origemDoCusto: "estimado" });
      return {};
    });
    const linhas = await db().select().from(custosExternos).where(eq(custosExternos.execucaoId, execucaoId));
    expect(linhas.map((l) => [l.fonte, l.ramoId, l.origemDoCusto]).sort()).toEqual([
      ["apify", ramoA, "api"],
      ["groq", ramoB, "estimado"],
    ]);
  });

  it("depois do laço por ramos, o custo volta ao ramo da execucao (nenhum, ou o do disparo)", async () => {
    let execucaoId = 0;
    await executarComRegistro("laco-de-teste", async (id) => {
      execucaoId = id;
      definirRamoDoContexto(ramoA);
      restaurarRamoDoContexto();
      await registrarCustoExterno({ fonte: "groq", custoUsd: 0.002, unidades: 1, unidade: "minutos", origemDoCusto: "estimado" });
      return {};
    });
    const [depois] = await db().select().from(custosExternos).where(eq(custosExternos.execucaoId, execucaoId));
    expect(depois.ramoId).toBeNull();

    await executarComRegistro(
      "laco-de-teste-b",
      async (id) => {
        execucaoId = id;
        definirRamoDoContexto(ramoA);
        restaurarRamoDoContexto();
        await registrarCustoExterno({ fonte: "groq", custoUsd: 0.003, unidades: 1, unidade: "minutos", origemDoCusto: "estimado" });
        return {};
      },
      { ramoId: ramoB },
    );
    const [doDisparo] = await db().select().from(custosExternos).where(eq(custosExternos.execucaoId, execucaoId));
    expect(doDisparo.ramoId).toBe(ramoB);
  });

  it("fora de uma execução, o custo é gravado sem execução e sem ramo, e nunca lança", async () => {
    await registrarCustoExterno({ fonte: "groq", custoUsd: 0.001, unidades: 1, unidade: "minutos", origemDoCusto: "estimado" });
    const [l] = await db().select().from(custosExternos).where(eq(custosExternos.custoUsd, "0.001000"));
    expect(l.execucaoId).toBeNull();
    expect(l.ramoId).toBeNull();
    await expect(registrarCustoExterno({ fonte: "groq", custoUsd: 0.1, unidades: 1, unidade: "minutos", origemDoCusto: "estimado", ramoId: 999999 })).resolves.toBeUndefined();
  });
});

describe("Custos: por ramo e fora da IA", () => {
  it("soma por ramo a IA e o que se paga fora dela, separa o que não é de um ramo, e totaliza o fora da IA por serviço", async () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db().update(geracoesIA).set({ criadoEm: ontem });
    await db().update(custosExternos).set({ criadoEm: ontem });
    const c = await custosDoAdmin();
    const a = c.porRamo.find((r) => r.nichoId === ramoA);
    const b = c.porRamo.find((r) => r.nichoId === ramoB);
    expect(a?.nome).toBe("Ramo A");
    expect(a!.foraUsd).toBeCloseTo(0.0123, 6);
    expect(b!.foraUsd).toBeCloseTo(custoDaTranscricaoGroqUsd(120) + 0.003, 6);
    expect(a!.usd).toBeCloseTo(a!.iaUsd + a!.foraUsd, 8);
    expect(c.foraDaIA.linhas.map((l) => l.fonte).sort()).toEqual(["apify", "groq"]);
    expect(c.foraDaIA.linhas.find((l) => l.fonte === "apify")!.algumEstimado).toBe(false);
    expect(c.foraDaIA.linhas.find((l) => l.fonte === "groq")!.algumEstimado).toBe(true);
    expect(c.foraDaIA.totalUsd).toBeCloseTo(c.foraDaIA.linhas.reduce((x, l) => x + l.usd, 0), 8);
    expect(c.semRamoUsd).toBeGreaterThan(0);
  });
});
