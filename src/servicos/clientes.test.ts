import { describe, expect, it } from "vitest";

import { dadosFixosSchema, ErroAcessoNegado, garantirSessaoAdmin } from "./clientes";

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

describe("dadosFixosSchema (validacao dos dados fixos do briefing)", () => {
  const base = { nome: "Sorriso Novo", cidade: "São Paulo", persona: "negocio" as const };

  it("aceita nome, cidade, persona e um nicho da lista", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, nichoId: 1 });
    expect(resultado.success).toBe(true);
  });

  it("aceita ramo por texto livre quando o cliente escolhe outro", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, ramoOutro: "clínica veterinária" });
    expect(resultado.success).toBe(true);
  });

  it("recusa sem nichoId e sem ramoOutro", () => {
    const resultado = dadosFixosSchema.safeParse(base);
    expect(resultado.success).toBe(false);
  });

  it("recusa nome em branco", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, nichoId: 1, nome: "   " });
    expect(resultado.success).toBe(false);
  });

  it("recusa persona fora da lista", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, nichoId: 1, persona: "outra-coisa" });
    expect(resultado.success).toBe(false);
  });

  it("bairro, perfis e quem grava sao opcionais", () => {
    const resultado = dadosFixosSchema.safeParse({
      ...base,
      nichoId: 1,
      perfis: { instagram: "@sorriso" },
    });
    expect(resultado.success).toBe(true);
  });
});
