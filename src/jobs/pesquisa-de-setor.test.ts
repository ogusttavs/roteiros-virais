/**
 * `escolherTermosParaPesquisa` (P2, item 0b da revisão do PR #74): os termos mais curtos primeiro
 * (mais genéricos), até o limite configurado.
 */
import { describe, expect, it, vi } from "vitest";

import { config } from "@/lib/config";

import { buscarBusinessDiscovery } from "./meta-api";
import { confirmarInstagram, escolherTermosParaPesquisa } from "./pesquisa-de-setor";

vi.mock("./meta-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("./meta-api")>();
  return { ...original, buscarBusinessDiscovery: vi.fn() };
});

describe("confirmarInstagram: o @ entra cru na expressão de campos da Graph API", () => {
  it("um @ com parênteses, chaves ou vírgula nunca chega à Meta, nem com a Meta ligada", async () => {
    const original = config.coleta.metaAtivo;
    config.coleta.metaAtivo = true;
    try {
      for (const handle of ["x){id,followers_count},media{caption", "a b", "a(b)", "a,b", "a{b}", "", "a".repeat(31)]) {
        expect(await confirmarInstagram(handle), handle).toBeNull();
      }
      expect(buscarBusinessDiscovery).not.toHaveBeenCalled();
    } finally {
      config.coleta.metaAtivo = original;
    }
  });
});

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
