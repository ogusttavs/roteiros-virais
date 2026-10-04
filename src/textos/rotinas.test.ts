import { describe, expect, it } from "vitest";

import { fraseDoErro, FRASE_DE_ERRO_GENERICA } from "./rotinas";

describe("fraseDoErro", () => {
  it("os casos conhecidos viram frase", () => {
    expect(fraseDoErro("Your credit balance is too low to access the Anthropic API")).toContain("crédito");
    expect(fraseDoErro("Apify: monthly usage limit exceeded")).toContain("Apify");
    expect(fraseDoErro("youtube: Sign in to confirm you are not a bot")).toContain("YouTube");
    expect(fraseDoErro("Error: ETIMEDOUT")).toContain("tempo limite");
    expect(fraseDoErro("connect ECONNREFUSED 127.0.0.1:5432")).toContain("banco de dados");
  });

  it("o resto é a frase genérica, e nunca o texto cru", () => {
    expect(fraseDoErro("algo muito estranho com segredo=abc123")).toBe(FRASE_DE_ERRO_GENERICA);
    expect(fraseDoErro(null)).toBe(FRASE_DE_ERRO_GENERICA);
  });
});
