import { describe, expect, it } from "vitest";

import { textosHoje } from "./hoje";

describe("textosHoje.constanciaSemana (revisao do PR #31, item 2)", () => {
  it("zero dias tem frase propria, nunca '0 dos ultimos 7 dias'", () => {
    expect(textosHoje.constanciaSemana(0)).toBe("Você ainda não gravou nesta semana. Gravar hoje começa o ritmo.");
  });

  it("conta os dias gravados dos ultimos 7", () => {
    expect(textosHoje.constanciaSemana(3)).toBe("Você gravou 3 dos últimos 7 dias. Gravar hoje mantém o ritmo.");
  });

  it("sete de sete tambem usa a mesma frase", () => {
    expect(textosHoje.constanciaSemana(7)).toBe("Você gravou 7 dos últimos 7 dias. Gravar hoje mantém o ritmo.");
  });
});

describe("textosHoje.evidencia (correcao do dia 1 da etapa 14, PROXIMO.md)", () => {
  it("so video, singular", () => {
    expect(textosHoje.evidencia(1, 0)).toBe("1 vídeo fora da curva esta semana");
  });

  it("so video, plural", () => {
    expect(textosHoje.evidencia(3, 0)).toBe("3 vídeos fora da curva esta semana");
  });

  it("so noticia, singular", () => {
    expect(textosHoje.evidencia(0, 1)).toBe("1 notícia do setor esta semana");
  });

  it("so noticia, plural", () => {
    expect(textosHoje.evidencia(0, 2)).toBe("2 notícias do setor esta semana");
  });

  it("video e noticia juntos, como no exemplo do PROXIMO.md", () => {
    expect(textosHoje.evidencia(3, 1)).toBe("3 vídeos e 1 notícia esta semana");
  });
});

describe("textosHoje.evidenciaMultiplo (revisao do PR #31, item 4)", () => {
  it("monta rotulo, views e quando", () => {
    expect(textosHoje.evidenciaMultiplo("acima do normal dessa conta", "12 mil", "hoje")).toBe(
      "acima do normal dessa conta, 12 mil visualizações hoje",
    );
    expect(textosHoje.evidenciaMultiplo("na média dessa conta", "1", "ontem")).toBe(
      "na média dessa conta, 1 visualização ontem",
    );
  });
});
