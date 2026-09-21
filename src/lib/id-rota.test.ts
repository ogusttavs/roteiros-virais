import { describe, expect, it } from "vitest";

import { idDaRotaOuNulo } from "./id-rota";

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
