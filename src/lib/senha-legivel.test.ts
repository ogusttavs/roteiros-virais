import { describe, expect, it } from "vitest";

import { gerarSenhaLegivel } from "./senha-legivel";

describe("gerarSenhaLegivel", () => {
  it("gera no formato substantivo-adjetivo-numero-substantivo", () => {
    const senha = gerarSenhaLegivel();
    expect(senha).toMatch(/^[a-zçã]+-[a-zçã]+-\d{2}-[a-zçã]+$/);
  });

  it("gera senhas diferentes em chamadas seguidas (nao trava num valor so)", () => {
    const senhas = new Set(Array.from({ length: 20 }, () => gerarSenhaLegivel()));
    expect(senhas.size).toBeGreaterThan(1);
  });
});
