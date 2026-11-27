import { describe, expect, it } from "vitest";

import { ENUNCIADO_P12_ANTES_DA_SEPARACAO, perguntaPorId, VERSAO_P12_SEPARADA } from "@/config/briefing";
import type { AvaliacaoResposta } from "@/db/schema";

import {
  blocoInicial,
  calcularNotaGeral,
  enunciadoParaLer,
  p13CobertaPelaP12Antiga,
  perguntaQueMaisAjuda,
  resumirMelhorar,
} from "./briefing-regras";

function avaliacao(nota: number): AvaliacaoResposta {
  return { nota, bom: "", melhorar: "", como: "", impacto: "" };
}

/** E76 PR 2: a avaliação da P12 feita depois da separação (com a versão do enunciado). */
function avaliacaoP12Nova(nota: number): AvaliacaoResposta {
  return { ...avaliacao(nota), versaoPergunta: VERSAO_P12_SEPARADA };
}

/** As treze perguntas avaliadas, a P12 já na versão separada. */
function treze(nota: number): Record<string, AvaliacaoResposta> {
  const avaliacoes = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`p${i + 1}`, avaliacao(nota)]));
  avaliacoes.p12 = avaliacaoP12Nova(nota);
  return avaliacoes;
}

describe("calcularNotaGeral", () => {
  it("nenhuma resposta avaliada da nota zero", () => {
    expect(calcularNotaGeral({}, "negocio")).toBe(0);
  });

  it("todas as treze na mesma nota da essa nota, independente do peso", () => {
    expect(calcularNotaGeral(treze(8), "negocio")).toBe(8);
    expect(calcularNotaGeral(treze(8), "pessoa")).toBe(8);
  });

  it("perguntas de peso 2 (p1, p5, p9, p11) pesam o dobro das outras", () => {
    const avaliacoes = treze(0);
    for (const id of ["p1", "p5", "p9", "p11"]) avaliacoes[id] = avaliacao(10);
    // 4 perguntas de peso 2 em nota 10 (soma 80), 7 de peso 1 e 2 de peso 0,5 em nota 0: 80/16 = 5.
    expect(calcularNotaGeral(avaliacoes, "negocio")).toBe(5);
  });

  it("E76 PR 2: a P12 e a P13 pesam meio cada, e juntas pesam o que a P12 antiga pesava", () => {
    const avaliacoes = treze(0);
    avaliacoes.p12 = avaliacaoP12Nova(10);
    avaliacoes.p13 = avaliacao(10);
    // 0,5 x 10 + 0,5 x 10 = 10, sobre a soma dos pesos, que continua 16.
    expect(calcularNotaGeral(avaliacoes, "negocio")).toBe(0.63);
    avaliacoes.p13 = avaliacao(0);
    expect(calcularNotaGeral(avaliacoes, "negocio")).toBe(0.31);
  });

  it("pergunta sem avaliacao conta nota zero na media", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = { p1: avaliacao(10) };
    expect(calcularNotaGeral(avaliacoes, "negocio")).toBeLessThan(2);
  });
});

describe("perguntaQueMaisAjuda", () => {
  it("sem nenhuma avaliacao, escolhe a de maior peso entre as de nota zero", () => {
    const pergunta = perguntaQueMaisAjuda({}, "negocio");
    expect(pergunta?.peso).toBe(2);
  });

  it("escolhe a de maior peso entre as de menor nota, ignorando as outras", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    Object.assign(avaliacoes, treze(10));
    avaliacoes.p6 = avaliacao(3); // peso 1
    avaliacoes.p5 = avaliacao(3); // peso 2, mesma nota que p6

    const pergunta = perguntaQueMaisAjuda(avaliacoes, "negocio");
    expect(pergunta?.id).toBe("p5");
  });

  it("nao pega a de peso maior se a nota dela nao e a menor", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    Object.assign(avaliacoes, treze(10));
    avaliacoes.p6 = avaliacao(2); // peso 1, a unica com a nota mais baixa

    const pergunta = perguntaQueMaisAjuda(avaliacoes, "negocio");
    expect(pergunta?.id).toBe("p6");
  });
});

describe("blocoInicial", () => {
  it("sem nenhuma avaliacao, comeca no bloco 1", () => {
    expect(blocoInicial({}, "negocio")).toBe(1);
  });

  it("com o bloco 1 completo, pula para o bloco 2", () => {
    const avaliacoes: Record<string, AvaliacaoResposta> = {
      p1: avaliacao(9),
      p2: avaliacao(9),
      p3: avaliacao(9),
    };
    expect(blocoInicial(avaliacoes, "negocio")).toBe(2);
  });

  it("com todas as treze avaliadas, fica no ultimo bloco", () => {
    expect(blocoInicial(treze(9), "negocio")).toBe(5);
  });
});

/**
 * E76 PR 2: a marca que respondeu a P12 antes da separação (o texto fala dos concorrentes e dos
 * admirados, e a avaliação não tem `versaoPergunta`) não perde nota nem trava por causa da P13 nova.
 */
describe("a P12 de antes da separação cobre a P13", () => {
  /** O briefing de antes: as doze avaliadas, nenhuma com a versão. */
  function dozeDeAntes(notas: Partial<Record<string, number>> = {}, padrao = 8.4): Record<string, AvaliacaoResposta> {
    return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i + 1}`, avaliacao(notas[`p${i + 1}`] ?? padrao)]));
  }

  /** A conta de antes da E76: doze perguntas, P12 com peso 1, soma dos pesos 16. */
  function notaDeAntes(avaliacoes: Record<string, AvaliacaoResposta>): number {
    const pesos: Record<string, number> = { p1: 2, p5: 2, p9: 2, p11: 2 };
    let soma = 0;
    for (let i = 1; i <= 12; i++) soma += (pesos[`p${i}`] ?? 1) * (avaliacoes[`p${i}`]?.nota ?? 0);
    return Math.round((soma / 16) * 100) / 100;
  }

  it("a nota geral é exatamente a de antes, nos dois tipos, mesmo com a P12 abaixo ou acima das outras", () => {
    for (const notas of [{}, { p12: 3 }, { p12: 10, p3: 5 }, { p1: 6, p12: 7.5 }]) {
      const avaliacoes = dozeDeAntes(notas);
      expect(p13CobertaPelaP12Antiga(avaliacoes)).toBe(true);
      expect(calcularNotaGeral(avaliacoes, "negocio")).toBe(notaDeAntes(avaliacoes));
      expect(calcularNotaGeral(avaliacoes, "pessoa")).toBe(notaDeAntes(avaliacoes));
    }
  });

  it("quem estava em 8 continua em 8: não trava abaixo da meta", () => {
    expect(calcularNotaGeral(dozeDeAntes({}, 8), "negocio")).toBe(8);
  });

  it("a P13 coberta não é a pergunta que mais ajuda, nem prende o Começar no bloco 5", () => {
    const avaliacoes = dozeDeAntes({}, 10);
    avaliacoes.p6 = avaliacao(4);
    expect(perguntaQueMaisAjuda(avaliacoes, "negocio")?.id).toBe("p6");
    expect(blocoInicial(dozeDeAntes({}, 10), "negocio")).toBe(5);
    expect(perguntaQueMaisAjuda(dozeDeAntes({}, 10), "negocio")?.id).not.toBe("p13");
  });

  it("a P13 respondida manda: a avaliação própria dela entra no lugar da P12 antiga", () => {
    const avaliacoes = { ...dozeDeAntes({}, 8), p13: avaliacao(4) };
    expect(p13CobertaPelaP12Antiga(avaliacoes)).toBe(false);
    // 15,5 x 8 + 0,5 x 4 = 126, sobre 16.
    expect(calcularNotaGeral(avaliacoes, "negocio")).toBe(7.88);
  });

  it("a P12 avaliada de novo (com a versão) não cobre mais a P13, que conta zero até ser respondida", () => {
    const avaliacoes = { ...dozeDeAntes({}, 8), p12: avaliacaoP12Nova(8) };
    expect(p13CobertaPelaP12Antiga(avaliacoes)).toBe(false);
    expect(calcularNotaGeral(avaliacoes, "negocio")).toBe(7.75);
    expect(perguntaQueMaisAjuda(avaliacoes, "negocio")?.id).toBe("p13");
  });

  it("sem a P12 avaliada (editada e ainda sem nota), a P13 não é coberta", () => {
    const avaliacoes = dozeDeAntes({}, 8);
    delete avaliacoes.p12;
    expect(p13CobertaPelaP12Antiga(avaliacoes)).toBe(false);
  });

  it("a resposta antiga é lida com o enunciado de antes; a nova, com o de agora", () => {
    for (const tipo of ["negocio", "pessoa"] as const) {
      const p12 = perguntaPorId("p12", tipo)!;
      const p13 = perguntaPorId("p13", tipo)!;
      expect(enunciadoParaLer(p12, dozeDeAntes(), tipo)).toBe(ENUNCIADO_P12_ANTES_DA_SEPARACAO[tipo]);
      expect(enunciadoParaLer(p12, { ...dozeDeAntes(), p12: avaliacaoP12Nova(8) }, tipo)).toBe(p12.enunciado);
      expect(enunciadoParaLer(p12, { ...dozeDeAntes(), p13: avaliacao(8) }, tipo)).toBe(p12.enunciado);
      expect(enunciadoParaLer(p13, dozeDeAntes(), tipo)).toBe(p13.enunciado);
    }
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
