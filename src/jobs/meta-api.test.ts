import { describe, expect, it } from "vitest";

import { calcularEsperaMs, ErroMetaApi, erroMetaEhDaConta, erroMetaEhTokenOuLimite, JANELA_MS } from "./meta-api";

describe("erroMetaEhDaConta", () => {
  it("codigo 100 (conta pessoal ou de criador) e da conta", () => {
    expect(erroMetaEhDaConta(new ErroMetaApi("x", 100))).toBe(true);
  });

  it.each([190, 4, 17, 32, 613, 1, undefined])("codigo %s nao e da conta", (codigo) => {
    expect(erroMetaEhDaConta(new ErroMetaApi("x", codigo))).toBe(false);
  });
});

describe("erroMetaEhTokenOuLimite", () => {
  it.each([190, 4, 17, 32, 613])("codigo %i (token vencido ou limite de taxa) e token ou limite", (codigo) => {
    expect(erroMetaEhTokenOuLimite(new ErroMetaApi("x", codigo))).toBe(true);
  });

  it.each([100, 1, undefined])("codigo %s nao e token ou limite", (codigo) => {
    expect(erroMetaEhTokenOuLimite(new ErroMetaApi("x", codigo))).toBe(false);
  });
});

describe("calcularEsperaMs", () => {
  it("meia janela ja passada, falta a outra metade", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T10:30:00Z");
    expect(calcularEsperaMs(maisAntiga, agora)).toBe(JANELA_MS / 2);
  });

  it("janela inteira ja passada, nada a esperar (nunca negativo)", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T12:00:00Z");
    expect(calcularEsperaMs(maisAntiga, agora)).toBe(0);
  });

  it("agora igual a mais antiga, falta a janela inteira", () => {
    const instante = new Date("2026-09-09T10:00:00Z");
    expect(calcularEsperaMs(instante, instante)).toBe(JANELA_MS);
  });

  it("respeita uma janela customizada", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T10:00:05Z");
    expect(calcularEsperaMs(maisAntiga, agora, 10_000)).toBe(5_000);
  });
});
