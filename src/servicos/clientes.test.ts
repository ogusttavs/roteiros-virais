import { describe, expect, it } from "vitest";

import { ErroAcessoNegado, garantirSessaoAdmin } from "./clientes";

describe("garantirSessaoAdmin", () => {
  it("passa para sessao de admin", () => {
    expect(() => garantirSessaoAdmin({ user: { role: "admin" } })).not.toThrow();
  });

  it("recusa sessao de cliente", () => {
    expect(() => garantirSessaoAdmin({ user: { role: "cliente" } })).toThrow(ErroAcessoNegado);
  });

  it("recusa sessao sem papel", () => {
    expect(() => garantirSessaoAdmin({ user: {} })).toThrow(ErroAcessoNegado);
  });

  it("recusa sessao nula (nao autenticado)", () => {
    expect(() => garantirSessaoAdmin(null)).toThrow(ErroAcessoNegado);
  });
});
