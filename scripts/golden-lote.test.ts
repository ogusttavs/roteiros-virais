/**
 * O golden set pelo lote (`golden-lote.ts`) em mock: a ordem dos resultados, o caminho de um por vez (`GOLDEN_SEM_LOTE=1`) igual ao do lote, o custo pela metade, e os
 * scripts `avaliar:*` rodando de ponta a ponta pelo lote com o mesmo resultado de sempre.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as avaliarTemaIA from "../src/ia/prompts/avaliarTema";

import { avaliarAgendas } from "./avaliar-agendas";
import { avaliarBriefing } from "./avaliar-briefing";
import { avaliarRoteiros } from "./avaliar-roteiros";
import { avaliarStories } from "./avaliar-stories";
import { avaliarTemas } from "./avaliar-temas";
import { custoDoResultado, gerarVarios, gerarVariosOuErro, goldenEmLote } from "./golden-lote";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function pedido(tema: string) {
  return {
    tarefa: "avaliarTema" as const,
    nivel: avaliarTemaIA.nivel,
    effort: avaliarTemaIA.esforco,
    schema: avaliarTemaIA.schema,
    sistemaEstavel: avaliarTemaIA.montarSistemaEstavel({ perfilCompilado: "perfil", modeloNicho: "modelo", persona: "negocio", regrasCliente: [] }),
    entrada: avaliarTemaIA.montarEntrada({ tema, evidencias: [] }),
  };
}

describe("gerarVarios (mock)", () => {
  it("devolve um resultado por pedido, na mesma ordem, e lista vazia sem pedido", async () => {
    expect(await gerarVarios([], "nada")).toEqual([]);
    const resultados = await gerarVarios([pedido("a"), pedido("b"), pedido("c")], "temas");
    expect(resultados).toHaveLength(3);
    for (const r of resultados) expect(r.dados.pilares.viralizar.nota).toBeGreaterThanOrEqual(0);
  });

  it("GOLDEN_SEM_LOTE=1 volta ao um por vez, com o mesmo resultado do lote", async () => {
    const pedidos = [pedido("a"), pedido("b")];
    const emLote = await gerarVarios(pedidos, "temas");
    vi.stubEnv("GOLDEN_SEM_LOTE", "1");
    expect(goldenEmLote()).toBe(false);
    const umPorVez = await gerarVarios(pedidos, "temas");
    expect(umPorVez.map((r) => r.dados)).toEqual(emLote.map((r) => r.dados));
  });

  it("gerarVariosOuErro devolve o Error na posição do caso que falha, sem derrubar os outros", async () => {
    vi.stubEnv("GOLDEN_SEM_LOTE", "1");
    const quebrado = { ...pedido("x"), schema: avaliarTemaIA.schema.refine(() => false, "schema impossível") };
    const resultados = await gerarVariosOuErro([pedido("a"), quebrado, pedido("c")], "temas");
    expect(resultados[0]).not.toBeInstanceOf(Error);
    expect(resultados[1]).toBeInstanceOf(Error);
    expect(resultados[2]).not.toBeInstanceOf(Error);
    await expect(gerarVarios([pedido("a"), quebrado], "temas")).rejects.toThrow(/caso 2/);
  });

  it("o custo do lote é a metade do preço cheio", () => {
    const uso = { dados: {}, modelo: "m", tokensEntrada: 1_000_000, tokensSaida: 1_000_000, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };
    const lote = custoDoResultado("forte", uso);
    vi.stubEnv("GOLDEN_SEM_LOTE", "1");
    const cheio = custoDoResultado("forte", uso);
    expect(cheio).toBeGreaterThan(0);
    expect(lote).toBeCloseTo(cheio / 2, 8);
  });
});

describe("os scripts avaliar:* pelo lote (mock)", () => {
  function calar() {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  }

  it("roteiros: os 22 casos do exemplo, um reprovado no verificador (o de sempre), custo zero no mock", async () => {
    calar();
    const resultado = await avaliarRoteiros();
    expect(resultado.casos).toBe(22);
    expect(resultado.titulos).toHaveLength(22);
    expect(resultado.reprovadosNoVerificador).toBe(1);
    expect(resultado.custoTotalUsd).toBe(0);
  });

  it("briefing, temas, agendas e stories rodam de ponta a ponta com o resultado igual ao um por vez", async () => {
    calar();
    const emLote = [await avaliarBriefing(), await avaliarTemas(), await avaliarAgendas(), await avaliarStories()] as const;
    vi.stubEnv("GOLDEN_SEM_LOTE", "1");
    const umPorVez = [await avaliarBriefing(), await avaliarTemas(), await avaliarAgendas(), await avaliarStories()];
    expect(emLote).toEqual(umPorVez);
    expect(emLote[0].casos).toBeGreaterThan(0);
    expect((emLote[2] as { diasLidos: number }).diasLidos).toBeGreaterThan(0);
  });
});
