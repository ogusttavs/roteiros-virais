import { afterEach, describe, expect, it, vi } from "vitest";

import { avaliarEdicao } from "./avaliar-edicao";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o golden set da edição de vídeo (E47 PR 3)", () => {
  it("o exemplo tem três casos válidos e roda sob o simulador, sem falha nem custo, com a abertura certa, a legenda limpa e o cabeçalho de IA antes das chamadas", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const r = await avaliarEdicao();
    expect(r.ehExemplo).toBe(true);
    expect(r.casos).toBe(3);
    expect(r.casosFalhos).toBe(0);
    expect(r.custoUsd).toBe(0);
    expect(r.verificados).toBe(3);
    expect(r.aberturasCertas).toBe(3);
    expect(r.semProblemaNaLegenda).toBe(3);
    expect(r.semAlertaDeCorte).toBe(3);
    const impresso = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(impresso).toContain("IA: simulada");
    expect(impresso.indexOf("IA: simulada")).toBeLessThan(impresso.indexOf("caso 1/3"));
    expect(impresso).toContain("abertura certa: 3 de 3");
  });
});
