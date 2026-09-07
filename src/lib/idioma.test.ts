import { describe, expect, it } from "vitest";

import { pareceTextoEmPortugues } from "./idioma";

describe("pareceTextoEmPortugues", () => {
  it("aprova um trecho de analise em portugues (uso normal)", () => {
    expect(
      pareceTextoEmPortugues(
        "o vídeo começa com uma pergunta e depois mostra o passo a passo para conseguir o resultado",
      ),
    ).toBe(true);
  });

  it("reprova um trecho copiado em ingles (caso real de 06/09, video em ingles)", () => {
    expect(pareceTextoEmPortugues("pour the coca-cola slowly into the glass and watch what happens")).toBe(false);
  });

  it("reprova um gancho em ingles mesmo quando so esse campo veio errado (caso misto de 06/09)", () => {
    expect(pareceTextoEmPortugues("you never cleaned this part of the kitchen properly before today")).toBe(false);
  });

  it("nao reprova texto curto demais para dar sinal confiavel", () => {
    expect(pareceTextoEmPortugues("limpeza profunda")).toBe(true);
    expect(pareceTextoEmPortugues("clean the sofa")).toBe(true);
  });

  it("texto vazio nao reprova (nada para checar)", () => {
    expect(pareceTextoEmPortugues("")).toBe(true);
  });
});
