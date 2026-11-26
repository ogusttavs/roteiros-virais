import { describe, expect, it } from "vitest";

import { ALFABETO_SENHA, GRUPOS_SENHA, gerarSenhaLegivel } from "./senha-legivel";

describe("gerarSenhaLegivel", () => {
  it("tem 13 caracteres em tres grupos, so do alfabeto legivel", () => {
    const senha = gerarSenhaLegivel();
    expect(senha).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{5}$/);
    for (const c of senha.replaceAll("-", "")) expect(ALFABETO_SENHA).toContain(c);
  });

  it("o alfabeto nao tem simbolos que se confundem e tem acaso para pelo menos 60 bits", () => {
    expect(ALFABETO_SENHA).not.toMatch(/[01oli]/);
    expect(new Set(ALFABETO_SENHA).size).toBe(ALFABETO_SENHA.length);
    const total = GRUPOS_SENHA.reduce((a, b) => a + b, 0);
    expect(total * Math.log2(ALFABETO_SENHA.length)).toBeGreaterThanOrEqual(60);
  });

  it("gera senhas diferentes em chamadas seguidas", () => {
    const senhas = new Set(Array.from({ length: 200 }, () => gerarSenhaLegivel()));
    expect(senhas.size).toBe(200);
  });
});
