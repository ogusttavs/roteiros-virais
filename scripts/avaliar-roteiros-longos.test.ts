import { afterEach, describe, expect, it, vi } from "vitest";

import { avaliarRoteirosLongos } from "./avaliar-roteiros-longos";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o golden set do roteiro longo (E52, PR 3)", () => {
  it("o exemplo tem seis casos válidos e, sob o simulador, todos passam no verificador na primeira tentativa, sem custo nem falha", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarRoteirosLongos();
    expect(resultado.ehExemplo).toBe(true);
    expect(resultado.casos).toBe(6);
    expect(resultado.casosFalhos).toBe(0);
    expect(resultado.reprovadosNoVerificador).toBe(0);
    expect(resultado.reprovadosNa1aTentativa).toBe(0);
    expect(resultado.custoTotalUsd).toBe(0);
    const impresso = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(impresso).toContain("IA: simulada");
    expect(impresso).toContain("ganchos inteiros:");
  });

  it("prova o formato do capítulo: o gancho de cada capítulo vem inteiro e o resto em pontos curtos", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarRoteirosLongos();
    // seis casos, de 3 a 6 capítulos cada: todo capítulo que não é o último traz o gancho inteiro
    expect(resultado.capitulosComGancho).toBeGreaterThanOrEqual(6 * 2);
    expect(resultado.ganchosInteiros).toBe(resultado.capitulosComGancho);
    // e o resto vem em pontos: nenhum passa de 20 palavras
    expect(resultado.pontos).toBeGreaterThanOrEqual(resultado.capitulosComGancho * 2);
    expect(resultado.pontosAcimaDoLimite).toBe(0);
  });

  it("o 'Copiar os capítulos' de cada caso volta como os mesmos capítulos", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarRoteirosLongos();
    expect(resultado.copiaQueNaoVolta).toBe(0);
  });
});
