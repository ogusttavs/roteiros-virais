import { describe, expect, it } from "vitest";

import type { AvaliacaoResposta } from "@/db/schema";

import { calcularNotaGeral } from "./briefing";

function avaliacao(nota: number): AvaliacaoResposta {
  return { nota, bom: "", melhorar: "", como: "", impacto: "" };
}

describe("calcularNotaGeral", () => {
  it("nenhuma resposta avaliada da nota zero", () => {
    expect(calcularNotaGeral({})).toBe(0);
  });

  it("todas as doze na mesma nota da essa nota, independente do peso", () => {
    const avaliacoes = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`p${i + 1}`, avaliacao(8)]),
    );
    expect(calcularNotaGeral(avaliacoes)).toBe(8);
  });

  it("perguntas de peso 2 (p1, p5, p9, p11) pesam o dobro das outras", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    for (const id of ["p1", "p5", "p9", "p11"]) avaliacoes[id] = avaliacao(10);
    for (let i = 1; i <= 12; i++) {
      const id = `p${i}`;
      if (!(id in avaliacoes)) avaliacoes[id] = avaliacao(0);
    }
    // 4 perguntas de peso 2 em nota 10 (soma 80), 8 de peso 1 em nota 0: 80/16 = 5.
    expect(calcularNotaGeral(avaliacoes)).toBe(5);
  });

  it("pergunta sem avaliacao conta nota zero na media", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = { p1: avaliacao(10) };
    expect(calcularNotaGeral(avaliacoes)).toBeLessThan(2);
  });
});
