import { describe, expect, it } from "vitest";

import { LIMITES_DA_LEGENDA } from "@/config/publicacao";

import { problemaDaLegenda } from "./legenda-do-instagram";

describe("a legenda contra os limites do Instagram", () => {
  it("uma legenda normal passa, com hashtags e marcações dentro do limite", () => {
    expect(problemaDaLegenda("Hoje no balcão: três dicas para o seu negócio #dica #vendas @parceiro")).toBeNull();
    expect(problemaDaLegenda("")).toBeNull();
  });

  it("2.200 letras passam e 2.201 não (conta letras, não bytes: acento e emoji contam uma)", () => {
    expect(problemaDaLegenda("a".repeat(LIMITES_DA_LEGENDA.caracteres))).toBeNull();
    expect(problemaDaLegenda("a".repeat(LIMITES_DA_LEGENDA.caracteres + 1))).toBe("legenda-longa");
    expect(problemaDaLegenda("é".repeat(LIMITES_DA_LEGENDA.caracteres))).toBeNull();
  });

  it("30 hashtags passam e 31 não", () => {
    const hashtags = (n: number) => Array.from({ length: n }, (_, i) => `#tag${i}`).join(" ");
    expect(problemaDaLegenda(hashtags(30))).toBeNull();
    expect(problemaDaLegenda(hashtags(31))).toBe("legenda-hashtags");
  });

  it("20 marcações com @ passam e 21 não", () => {
    const marcas = (n: number) => Array.from({ length: n }, (_, i) => `@pessoa${i}`).join(" ");
    expect(problemaDaLegenda(marcas(20))).toBeNull();
    expect(problemaDaLegenda(marcas(21))).toBe("legenda-marcacoes");
  });

  it("hashtag com acento conta como uma", () => {
    expect(problemaDaLegenda(Array.from({ length: 31 }, (_, i) => `#promoção${i}`).join(" "))).toBe("legenda-hashtags");
  });
});
