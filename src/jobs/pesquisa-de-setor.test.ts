/**
 * `escolherTermosParaPesquisa` (P2, item 0b da revisão do PR #74): os termos mais curtos primeiro
 * (mais genéricos), até o limite configurado.
 */
import { describe, expect, it } from "vitest";

import { escolherTermosParaPesquisa } from "./pesquisa-de-setor";

describe("escolherTermosParaPesquisa", () => {
  it("ordena do mais curto para o mais longo", () => {
    const termos = ["produtos de limpeza multiuso", "limpeza", "faxina pesada em casa"];
    expect(escolherTermosParaPesquisa(termos, 3)).toEqual(["limpeza", "faxina pesada em casa", "produtos de limpeza multiuso"]);
  });

  it("corta no limite, mesmo com mais termos disponiveis", () => {
    const termos = ["aaaaa", "aa", "aaa", "a", "aaaa"];
    expect(escolherTermosParaPesquisa(termos, 2)).toEqual(["a", "aa"]);
  });

  it("limite maior que a lista devolve a lista inteira, ordenada", () => {
    const termos = ["bb", "a"];
    expect(escolherTermosParaPesquisa(termos, 10)).toEqual(["a", "bb"]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(escolherTermosParaPesquisa([], 8)).toEqual([]);
  });

  it("nao muda a lista original (funcao pura)", () => {
    const termos = ["bb", "a"];
    escolherTermosParaPesquisa(termos, 1);
    expect(termos).toEqual(["bb", "a"]);
  });
});
