import { describe, expect, it } from "vitest";

import { textosHoje } from "./hoje";

describe("textosHoje.constancia", () => {
  it("seguidos no singular para n = 1", () => {
    expect(textosHoje.constancia.seguidos(1)).toBe("1 dia seguido gravando");
  });

  it("seguidos no plural para n = 2", () => {
    expect(textosHoje.constancia.seguidos(2)).toBe("2 dias seguidos gravando");
  });

  it("parado no singular para n = 1", () => {
    expect(textosHoje.constancia.parado(1)).toBe("faz 1 dia que você não grava");
  });

  it("parado no plural para n = 2", () => {
    expect(textosHoje.constancia.parado(2)).toBe("faz 2 dias que você não grava");
  });
});
