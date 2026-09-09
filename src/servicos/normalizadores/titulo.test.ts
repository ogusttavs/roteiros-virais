import { describe, expect, it } from "vitest";

import { tituloDeVideo } from "./titulo";

describe("tituloDeVideo", () => {
  it("usa a primeira linha da descricao como titulo", () => {
    expect(tituloDeVideo("3 erros que estragam o seu sorriso", "sorrisoemdia", null)).toBe(
      "3 erros que estragam o seu sorriso",
    );
  });

  it("so a primeira linha, quando a descricao tem mais de uma", () => {
    expect(tituloDeVideo("clareamento dental\n#dentista #sorriso", "sorrisoemdia", null)).toBe(
      "clareamento dental",
    );
  });

  it("corta em 90 caracteres", () => {
    const descricaoLonga = "a".repeat(120);
    const titulo = tituloDeVideo(descricaoLonga, "conta", null);
    expect(titulo).toHaveLength(90);
    expect(titulo).toBe("a".repeat(90));
  });

  it("sem descricao, mas com data: vídeo de @conta e a data por extenso, sem hora", () => {
    expect(tituloDeVideo(null, "sorrisoemdia", new Date("2026-09-05T23:50:00Z"))).toBe(
      "vídeo de @sorrisoemdia, 5 de setembro",
    );
  });

  it("descricao so com espaco ou quebra de linha conta como sem descricao", () => {
    expect(tituloDeVideo("   \n  ", "sorrisoemdia", new Date("2026-09-05T12:00:00Z"))).toBe(
      "vídeo de @sorrisoemdia, 5 de setembro",
    );
  });

  it("sem descricao e sem data, so vídeo de @conta", () => {
    expect(tituloDeVideo(null, "sorrisoemdia", null)).toBe("vídeo de @sorrisoemdia");
  });

  it("descricao vazia (string vazia) conta como sem descricao", () => {
    expect(tituloDeVideo("", "sorrisoemdia", null)).toBe("vídeo de @sorrisoemdia");
  });
});
