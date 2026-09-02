import { describe, expect, it } from "vitest";

import type { AvaliacaoResposta } from "@/db/schema";

import { blocoInicial, calcularNotaGeral, perguntaQueMaisAjuda } from "./briefing-regras";

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

describe("perguntaQueMaisAjuda", () => {
  it("sem nenhuma avaliacao, escolhe a de maior peso entre as de nota zero", () => {
    const pergunta = perguntaQueMaisAjuda({});
    expect(pergunta?.peso).toBe(2);
  });

  it("escolhe a de maior peso entre as de menor nota, ignorando as outras", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    for (let i = 1; i <= 12; i++) avaliacoes[`p${i}`] = avaliacao(10);
    avaliacoes.p6 = avaliacao(3); // peso 1
    avaliacoes.p5 = avaliacao(3); // peso 2, mesma nota que p6

    const pergunta = perguntaQueMaisAjuda(avaliacoes);
    expect(pergunta?.id).toBe("p5");
  });

  it("nao pega a de peso maior se a nota dela nao e a menor", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    for (let i = 1; i <= 12; i++) avaliacoes[`p${i}`] = avaliacao(10);
    avaliacoes.p6 = avaliacao(2); // peso 1, a unica com a nota mais baixa

    const pergunta = perguntaQueMaisAjuda(avaliacoes);
    expect(pergunta?.id).toBe("p6");
  });
});

describe("blocoInicial", () => {
  it("sem nenhuma avaliacao, comeca no bloco 1", () => {
    expect(blocoInicial({})).toBe(1);
  });

  it("com o bloco 1 completo, pula para o bloco 2", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {
      p1: avaliacao(9),
      p2: avaliacao(9),
      p3: avaliacao(9),
    };
    expect(blocoInicial(avaliacoes)).toBe(2);
  });

  it("com todas as doze avaliadas, fica no ultimo bloco", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    for (let i = 1; i <= 12; i++) avaliacoes[`p${i}`] = avaliacao(9);
    expect(blocoInicial(avaliacoes)).toBe(5);
  });
});
