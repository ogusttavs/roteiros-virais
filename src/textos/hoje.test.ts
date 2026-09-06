import { describe, expect, it } from "vitest";

import { textosHoje } from "./hoje";

describe("textosHoje.constancia", () => {
  it("seguidos no singular para n = 1", () => {
    expect(textosHoje.constancia.seguidos(1)).toBe("1 dia seguido gravando");
  });

  it("seguidos no plural para n = 2", () => {
    expect(textosHoje.constancia.seguidos(2)).toBe("2 dias seguidos gravando");
  });

  it("parado no singular para n = 1", () => {
    expect(textosHoje.constancia.parado(1)).toBe("faz 1 dia que você não grava");
  });

  it("parado no plural para n = 2", () => {
    expect(textosHoje.constancia.parado(2)).toBe("faz 2 dias que você não grava");
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
