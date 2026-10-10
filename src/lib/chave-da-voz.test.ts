import { describe, expect, it } from "vitest";

import { chaveDeVozValida } from "./chave-da-voz";

describe("chaveDeVozValida", () => {
  it("aceita doze caracteres hexadecimais minúsculos", () => {
    expect(chaveDeVozValida("0123456789ab")).toBe("0123456789ab");
  });

  it("recusa o que não tem essa forma: tamanho, maiúscula, texto, número, vazio, objeto", () => {
    for (const ruim of ["", "abc", "0123456789abc", "0123456789AB", "serve em camurca", "0123456789a;", " 0123456789ab", 123456789012, null, undefined, {}, ["0123456789ab"]]) {
      expect(chaveDeVozValida(ruim)).toBeUndefined();
    }
  });
});
