import { describe, expect, it } from "vitest";

import { conferirSenhaNova, SENHA_MAXIMO, SENHA_MINIMO } from "./senha-regras";

describe("conferirSenhaNova", () => {
  it("o mínimo é 8 caracteres", () => {
    expect(SENHA_MINIMO).toBe(8);
    expect(conferirSenhaNova("1234567")).toBe("curta");
    expect(conferirSenhaNova("12345678")).toBeNull();
  });

  it("o teto é o do better-auth (128)", () => {
    expect(conferirSenhaNova("a".repeat(SENHA_MAXIMO))).toBeNull();
    expect(conferirSenhaNova("a".repeat(SENHA_MAXIMO + 1))).toBe("longa");
  });

  it("com a repetição, as duas precisam ser iguais (a curta é recusada antes)", () => {
    expect(conferirSenhaNova("senha-boa-1", "senha-boa-1")).toBeNull();
    expect(conferirSenhaNova("senha-boa-1", "senha-boa-2")).toBe("nao_conferem");
    expect(conferirSenhaNova("curta", "diferente")).toBe("curta");
  });
});
