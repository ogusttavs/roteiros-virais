/**
 * `--direto` / `GOLDEN_SET_DIRETO=1` (pedido do Fable com o lote parado na fila da API): as mesmas chamadas pelo caminho normal (`src/ia/cliente.ts`), até 4 em paralelo, na mesma ordem, com o
 * custo cheio; o lote nem é criado. O padrão continua sendo o lote.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as avaliarTemaIA from "../src/ia/prompts/avaliarTema";

const estado = vi.hoisted(() => ({ ativos: 0, maximo: 0, chamadas: 0, lotes: 0, falhar: new Set<number>() }));

vi.mock("../src/ia/cliente", async () => {
  const real = await vi.importActual<typeof import("../src/ia/cliente")>("../src/ia/cliente");
  return {
    ...real,
    gerarEstruturado: async (params: Parameters<typeof real.gerarEstruturado>[0]) => {
      const minha = estado.chamadas++;
      estado.ativos += 1;
      estado.maximo = Math.max(estado.maximo, estado.ativos);
      await new Promise((resolver) => setTimeout(resolver, 10));
      estado.ativos -= 1;
      if (estado.falhar.has(minha)) throw new Error("falha de teste");
      return real.gerarEstruturado(params);
    },
  };
});
vi.mock("../src/ia/lote", async () => {
  const real = await vi.importActual<typeof import("../src/ia/lote")>("../src/ia/lote");
  return {
    ...real,
    criarLote: async (...args: Parameters<typeof real.criarLote>) => {
      estado.lotes += 1;
      return real.criarLote(...args);
    },
  };
});

import { custoDoResultado, gerarVarios, gerarVariosOuErro, goldenDireto, goldenEmLote } from "./golden-lote";

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

beforeEach(() => {
  estado.ativos = 0;
  estado.maximo = 0;
  estado.chamadas = 0;
  estado.lotes = 0;
  estado.falhar = new Set();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  // Estes testes medem o ajudante, não o modelo: liberam o simulador com `--direto` (ver `golden-lote.ts`).
  vi.stubEnv("GOLDEN_PERMITE_SIMULADO", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("o caminho direto dos golden sets", () => {
  it("o padrão é o lote: não é direto, usa o lote e não chama o cliente caso a caso", async () => {
    expect(goldenDireto()).toBe(false);
    expect(goldenEmLote()).toBe(true);
    await gerarVarios([pedido("a"), pedido("b")], "temas");
    expect(estado.lotes).toBe(1);
    expect(estado.chamadas).toBe(0);
  });

  it("GOLDEN_SET_DIRETO=1 troca o caminho: nenhum lote, uma chamada por pedido, no máximo 4 ao mesmo tempo, na mesma ordem, e o aviso do custo cheio", async () => {
    vi.stubEnv("GOLDEN_SET_DIRETO", "1");
    expect(goldenDireto()).toBe(true);
    expect(goldenEmLote()).toBe(false);
    const pedidos = Array.from({ length: 10 }, (_, i) => pedido(`tema ${i}`));
    const resultados = await gerarVarios(pedidos, "temas");
    expect(estado.lotes).toBe(0);
    expect(estado.chamadas).toBe(10);
    expect(estado.maximo).toBeGreaterThan(1);
    expect(estado.maximo).toBeLessThanOrEqual(4);
    expect(resultados).toHaveLength(10);
    const linhas = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(linhas.some((l) => l.includes("[direto]") && l.includes("CHEIO"))).toBe(true);
  });

  it("--direto na linha de comando faz o mesmo", async () => {
    const antes = process.argv;
    process.argv = [...antes, "--direto"];
    try {
      expect(goldenDireto()).toBe(true);
      await gerarVarios([pedido("a")], "temas");
      expect(estado.lotes).toBe(0);
      expect(estado.chamadas).toBe(1);
    } finally {
      process.argv = antes;
    }
  });

  it("o resultado é o mesmo do lote (mesmos dados, na mesma ordem), só o caminho muda", async () => {
    const pedidos = [pedido("a"), pedido("b"), pedido("c")];
    const emLote = await gerarVarios(pedidos, "temas");
    vi.stubEnv("GOLDEN_SET_DIRETO", "1");
    const direto = await gerarVarios(pedidos, "temas");
    expect(direto.map((r) => r.dados)).toEqual(emLote.map((r) => r.dados));
  });

  it("um caso que falha vem como Error na posição dele, e os outros seguem", async () => {
    vi.stubEnv("GOLDEN_SET_DIRETO", "1");
    estado.falhar = new Set([1]);
    const resultados = await gerarVariosOuErro([pedido("a"), pedido("b"), pedido("c")], "temas");
    expect(resultados.filter((r) => r instanceof Error)).toHaveLength(1);
    expect(resultados.filter((r) => !(r instanceof Error))).toHaveLength(2);
  });

  it("o custo é o cheio no direto e a metade no lote", () => {
    const uso = { dados: {}, modelo: "m", tokensEntrada: 1_000_000, tokensSaida: 1_000_000, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };
    const lote = custoDoResultado("forte", uso);
    vi.stubEnv("GOLDEN_SET_DIRETO", "1");
    expect(custoDoResultado("forte", uso)).toBeCloseTo(lote * 2, 8);
  });
});
