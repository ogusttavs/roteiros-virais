import { describe, expect, it } from "vitest";

import type { AvaliacaoResposta } from "@/db/schema";

import { blocoInicial, calcularNotaGeral, perguntaQueMaisAjuda, resumirMelhorar } from "./briefing-regras";

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

describe("resumirMelhorar", () => {
  it("texto vazio devolve vazio", () => {
    expect(resumirMelhorar("")).toBe("");
    expect(resumirMelhorar("   ")).toBe("");
  });

  it("corta na primeira pontuacao final, incluindo ela, sem reticencia", () => {
    expect(resumirMelhorar("Falta o publico. O resto esta otimo, com numero e exemplo reais.")).toBe(
      "Falta o publico.",
    );
  });

  it("aceita ! e ? como pontuacao final, nao so ponto final", () => {
    expect(resumirMelhorar("Rende quanto? Isso falta na resposta.")).toBe("Rende quanto?");
    expect(resumirMelhorar("Faltou o numero! Volte e complete.")).toBe("Faltou o numero!");
  });

  it("texto curto sem pontuacao final devolve o texto inteiro, sem reticencia", () => {
    expect(resumirMelhorar("falta o numero")).toBe("falta o numero");
  });

  it("sem pontuacao final e maior que 90 caracteres, corta em 90 com reticencia", () => {
    const texto = "a".repeat(120);
    const resultado = resumirMelhorar(texto);
    expect(resultado).toBe(`${"a".repeat(90)}…`);
    expect(resultado.length).toBe(91);
  });

  it("primeira pontuacao final depois de 90 caracteres, corta em 90 com reticencia", () => {
    const texto = `${"a".repeat(95)}. resto da frase.`;
    const resultado = resumirMelhorar(texto);
    expect(resultado).toBe(`${"a".repeat(90)}…`);
  });

  it("pontuacao final exatamente na posicao 90 (indice 89), inclui ela, sem reticencia", () => {
    const texto = `${"a".repeat(89)}. resto da frase`;
    const resultado = resumirMelhorar(texto);
    expect(resultado).toBe(`${"a".repeat(89)}.`);
    expect(resultado.length).toBe(90);
  });

  it("ponto de numero nao conta como fim de frase (revisao do PR #27, item 4)", () => {
    expect(resumirMelhorar("Diga quanto rende: 1.200 ml por frasco. O resto está bom.")).toBe(
      "Diga quanto rende: 1.200 ml por frasco.",
    );
  });

  it("ponto de numero no fim do texto tambem nao corta, devolve o texto inteiro", () => {
    expect(resumirMelhorar("Custa R$ 1.200.")).toBe("Custa R$ 1.200.");
  });

  it("ponto de abreviacao (sem espaço depois) nao conta como fim de frase", () => {
    expect(resumirMelhorar("Ex.: um caso real. Outro.")).toBe("Ex.: um caso real.");
  });
});
