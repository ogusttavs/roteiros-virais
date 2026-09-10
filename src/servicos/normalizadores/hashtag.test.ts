import { describe, expect, it } from "vitest";

import { normalizarHashtag } from "./hashtag";

describe("normalizarHashtag", () => {
  it("tira espaco", () => {
    expect(normalizarHashtag("mancha no sofa")).toBe("manchanosofa");
  });

  it("tira acento", () => {
    expect(normalizarHashtag("limpeza a seco")).toBe("limpezaaseco");
    expect(normalizarHashtag("são paulo")).toBe("saopaulo");
  });

  it("vira minusculo", () => {
    expect(normalizarHashtag("Casa Cheirosa")).toBe("casacheirosa");
  });

  it("tira pontuacao e outros simbolos, mantendo underscore", () => {
    expect(normalizarHashtag("limpeza_de_vidro!")).toBe("limpeza_de_vidro");
    expect(normalizarHashtag("mancha? no sofá?!")).toBe("manchanosofa");
  });

  it("termo ja valido fica igual", () => {
    expect(normalizarHashtag("dentista")).toBe("dentista");
  });
});
