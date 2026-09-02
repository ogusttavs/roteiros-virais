import { describe, expect, it } from "vitest";

import { faixaDeNota } from "./notaFaixa";

describe("faixaDeNota", () => {
  it("abaixo de 5 e baixa", () => {
    expect(faixaDeNota(0)).toBe("baixa");
    expect(faixaDeNota(4.9)).toBe("baixa");
  });

  it("de 5 a 8 (exclusive) e media", () => {
    expect(faixaDeNota(5)).toBe("media");
    expect(faixaDeNota(7.9)).toBe("media");
  });

  it("8 ou mais e alta", () => {
    expect(faixaDeNota(8)).toBe("alta");
    expect(faixaDeNota(10)).toBe("alta");
  });
});
