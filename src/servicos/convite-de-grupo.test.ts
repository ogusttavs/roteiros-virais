import { describe, expect, it } from "vitest";

import { codigoTemFormatoValido, gerarCodigoDoConvite, hashDoCodigoDoConvite, nomeDeEmpresaValido } from "./convite-de-grupo";

describe("o código do convite de grupo", () => {
  it("gera 43 caracteres base64url, diferentes a cada vez", () => {
    const a = gerarCodigoDoConvite();
    const b = gerarCodigoDoConvite();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("o hash é sha256 em hexadecimal e não contém o código", () => {
    const codigo = gerarCodigoDoConvite();
    const hash = hashDoCodigoDoConvite(codigo);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashDoCodigoDoConvite(codigo));
    expect(hash).not.toContain(codigo);
  });

  it("só aceita o formato do código", () => {
    expect(codigoTemFormatoValido(gerarCodigoDoConvite())).toBe(true);
    for (const ruim of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)} `, undefined, 42, null, {}]) {
      expect(codigoTemFormatoValido(ruim)).toBe(false);
    }
  });
});

describe("o nome da empresa", () => {
  it("apara, junta espaços e confere o tamanho", () => {
    expect(nomeDeEmpresaValido("  Clinica   Centro ")).toBe("Clinica Centro");
    expect(nomeDeEmpresaValido("a")).toBeNull();
    expect(nomeDeEmpresaValido("x".repeat(81))).toBeNull();
    expect(nomeDeEmpresaValido(undefined)).toBeNull();
    expect(nomeDeEmpresaValido("x".repeat(80))).toBe("x".repeat(80));
  });
});
