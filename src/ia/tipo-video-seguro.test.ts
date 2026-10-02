import { describe, expect, it } from "vitest";

import { corrigirTipoConteudoInvalido } from "./tipo-video-seguro";

describe("corrigirTipoConteudoInvalido", () => {
  it("tipoConteudo valido passa intocado, com o serveDeModelo que veio", () => {
    const bruto = { tipoConteudo: "meme", serveDeModelo: false, assunto: "x" };
    expect(corrigirTipoConteudoInvalido(bruto)).toEqual(bruto);
  });

  it("tipoConteudo invalido vira original, e serveDeModelo vira false mesmo que tivesse vindo true", () => {
    const bruto = { tipoConteudo: "anuncio", serveDeModelo: true, assunto: "x" };
    expect(corrigirTipoConteudoInvalido(bruto)).toEqual({ tipoConteudo: "original", serveDeModelo: false, assunto: "x" });
  });

  it("tipoConteudo do tipo errado (nao string) tambem conta como invalido", () => {
    const bruto = { tipoConteudo: 123, serveDeModelo: true };
    expect(corrigirTipoConteudoInvalido(bruto)).toEqual({ tipoConteudo: "original", serveDeModelo: false });
  });

  it("sem o campo tipoConteudo, devolve o valor sem mexer", () => {
    const bruto = { assunto: "x" };
    expect(corrigirTipoConteudoInvalido(bruto)).toBe(bruto);
  });

  it("entrada que nao e objeto devolve sem mexer", () => {
    expect(corrigirTipoConteudoInvalido(null)).toBeNull();
    expect(corrigirTipoConteudoInvalido("texto")).toBe("texto");
  });
});
