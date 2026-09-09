import { describe, expect, it } from "vitest";

import { mascararSegredos } from "./log";

describe("mascararSegredos", () => {
  it("mascara uma string que comeca com EAA", () => {
    expect(mascararSegredos("EAAsegredoqualquer123")).toBe("***token mascarado***");
  });

  it("nao mexe em string que nao comeca com EAA", () => {
    expect(mascararSegredos("erro qualquer")).toBe("erro qualquer");
  });

  it("mascara em qualquer profundidade de um objeto", () => {
    const objeto = {
      erro: "algo deu errado",
      contexto: { token: "EAAxyz", outro: { valor: "EAAoutravez" } },
    };
    expect(mascararSegredos(objeto)).toEqual({
      erro: "algo deu errado",
      contexto: { token: "***token mascarado***", outro: { valor: "***token mascarado***" } },
    });
  });

  it("mascara dentro de um array", () => {
    expect(mascararSegredos(["EAAum", "normal"])).toEqual(["***token mascarado***", "normal"]);
  });

  it("nao mexe em numero, booleano ou nulo", () => {
    expect(mascararSegredos(42)).toBe(42);
    expect(mascararSegredos(true)).toBe(true);
    expect(mascararSegredos(null)).toBeNull();
  });
});
