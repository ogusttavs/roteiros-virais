import { afterEach, describe, expect, it, vi } from "vitest";

import { descricaoDaIA, gerarVariosOuErro, recusaDoSimulado } from "./golden-lote";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("qual IA responde o golden set (06/10/2026)", () => {
  it("o cabeçalho diz simulada ou real, com os modelos", () => {
    expect(descricaoDaIA("mock", "forte", "barato")).toContain("IA: simulada");
    expect(descricaoDaIA("mock", "forte", "barato")).toContain("NÃO medem o modelo");
    expect(descricaoDaIA("anthropic", "claude-opus-5", "claude-haiku-4-5")).toBe("IA: real (modelo forte claude-opus-5, barato claude-haiku-4-5)");
  });

  it("--direto com o simulador é recusado, com o caminho certo; o lote simulado, o provedor real e o teste do ajudante passam", () => {
    expect(recusaDoSimulado("mock", true, false)).toContain("recusado: --direto");
    expect(recusaDoSimulado("mock", true, false)).toContain("AI_PROVIDER=anthropic");
    expect(recusaDoSimulado("mock", false, false)).toBeNull();
    expect(recusaDoSimulado("anthropic", true, false)).toBeNull();
    expect(recusaDoSimulado("mock", true, true)).toBeNull();
  });

  it("a rodada de verdade: --direto sob o simulador lança antes de chamar qualquer coisa, e o lote simulado imprime o cabeçalho", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("GOLDEN_SET_DIRETO", "1");
    vi.stubEnv("GOLDEN_PERMITE_SIMULADO", "");
    await expect(gerarVariosOuErro([{ tarefa: "avaliarTema" } as never], "temas")).rejects.toThrow("recusado: --direto");
    expect(log).not.toHaveBeenCalled();

    vi.stubEnv("GOLDEN_SET_DIRETO", "");
    await expect(gerarVariosOuErro([], "temas")).resolves.toEqual([]);
  });
});
