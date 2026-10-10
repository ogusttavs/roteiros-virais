import { describe, expect, it } from "vitest";

import { idDaRotaOuNulo, idDoBancoOuNulo } from "./id-rota";

describe("idDaRotaOuNulo", () => {
  it("aceita so digitos", () => {
    expect(idDaRotaOuNulo("1")).toBe(1);
    expect(idDaRotaOuNulo("42")).toBe(42);
  });

  it("recusa o formato que o Number.isFinite deixava passar (achado de seguranca)", () => {
    expect(idDaRotaOuNulo("1.0")).toBeNull();
    expect(idDaRotaOuNulo("1.")).toBeNull();
    expect(idDaRotaOuNulo(".1")).toBeNull();
  });

  it("recusa notacao cientifica e outros formatos que o Number aceita", () => {
    expect(idDaRotaOuNulo("1e10")).toBeNull();
    expect(idDaRotaOuNulo("0x1")).toBeNull();
    expect(idDaRotaOuNulo("Infinity")).toBeNull();
    expect(idDaRotaOuNulo("NaN")).toBeNull();
  });

  it("recusa negativo, espaco e texto", () => {
    expect(idDaRotaOuNulo("-1")).toBeNull();
    expect(idDaRotaOuNulo(" 1")).toBeNull();
    expect(idDaRotaOuNulo("1 ")).toBeNull();
    expect(idDaRotaOuNulo("abc")).toBeNull();
    expect(idDaRotaOuNulo("")).toBeNull();
  });

  it("recusa numero grande demais para ser um id seguro", () => {
    expect(idDaRotaOuNulo("99999999999999999999")).toBeNull();
  });
});

describe("idDoBancoOuNulo", () => {
  it("aceita só dígitos de 1 até o maior integer do Postgres, em texto ou em número", () => {
    expect(idDoBancoOuNulo("1")).toBe(1);
    expect(idDoBancoOuNulo("2147483647")).toBe(2_147_483_647);
    expect(idDoBancoOuNulo(42)).toBe(42);
    expect(idDoBancoOuNulo(2_147_483_647)).toBe(2_147_483_647);
  });

  it("recusa o que estoura a coluna e o que o Number deixava passar", () => {
    expect(idDoBancoOuNulo("2147483648")).toBeNull();
    expect(idDoBancoOuNulo("99999999999")).toBeNull();
    expect(idDoBancoOuNulo(99_999_999_999)).toBeNull();
    expect(idDoBancoOuNulo("1e3")).toBeNull();
    expect(idDoBancoOuNulo("0x10")).toBeNull();
    expect(idDoBancoOuNulo("1.5")).toBeNull();
    expect(idDoBancoOuNulo(1.5)).toBeNull();
  });

  it("recusa zero, negativo, vazio, nulo e o que não é número", () => {
    expect(idDoBancoOuNulo("0")).toBeNull();
    expect(idDoBancoOuNulo(0)).toBeNull();
    expect(idDoBancoOuNulo(-1)).toBeNull();
    expect(idDoBancoOuNulo("-1")).toBeNull();
    expect(idDoBancoOuNulo("")).toBeNull();
    expect(idDoBancoOuNulo(null)).toBeNull();
    expect(idDoBancoOuNulo(undefined)).toBeNull();
    expect(idDoBancoOuNulo(Number.NaN)).toBeNull();
    expect(idDoBancoOuNulo(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
