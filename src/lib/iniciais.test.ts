import { describe, expect, it } from "vitest";

import { iniciaisDe } from "./iniciais";

describe("iniciaisDe", () => {
  it("pega a primeira letra do nome", () => {
    expect(iniciaisDe("Maria Souza")).toBe("M");
  });

  it("ignora colchete e outros caracteres que nao sao letra", () => {
    expect(iniciaisDe("[9] Sorriso Novo")).toBe("S");
  });

  it("pega a primeira letra de verdade mesmo dentro de uma palavra entre colchetes", () => {
    expect(iniciaisDe("[exemplo] Sorriso Novo")).toBe("E");
  });

  it("funciona com acento", () => {
    expect(iniciaisDe("Álvaro")).toBe("Á");
  });

  it("devolve maiuscula mesmo quando o nome comeca minusculo", () => {
    expect(iniciaisDe("joão")).toBe("J");
  });

  it("devolve ? quando nao ha letra nenhuma", () => {
    expect(iniciaisDe("123")).toBe("?");
    expect(iniciaisDe("")).toBe("?");
  });
});
