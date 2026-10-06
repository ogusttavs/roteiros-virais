import { afterEach, describe, expect, it, vi } from "vitest";

import { avaliarTemaDoMomento } from "./avaliar-tema-do-momento";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o golden set do tema do momento (E55)", () => {
  it("o exemplo tem seis casos válidos, roda sob o simulador sem falha nem custo, e o cabeçalho de IA sai antes das chamadas", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarTemaDoMomento();
    expect(resultado.ehExemplo).toBe(true);
    expect(resultado.casos).toBe(6);
    expect(resultado.casosFalhos).toBe(0);
    expect(resultado.custoUsd).toBe(0);
    const impresso = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(impresso).toContain("IA: simulada");
    expect(impresso).toContain("acertos:");
  });
});
