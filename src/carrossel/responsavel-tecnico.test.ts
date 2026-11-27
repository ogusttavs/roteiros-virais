import { describe, expect, it } from "vitest";

import { MAXIMO_RESPONSAVEL_TECNICO, validarResponsavelTecnico } from "./responsavel-tecnico";

describe("validarResponsavelTecnico", () => {
  it("aceita a linha e limpa os espaços", () => {
    expect(validarResponsavelTecnico("  Dra. Maria   Souza, CRO-SP 12345 ")).toEqual({ ok: true, linha: "Dra. Maria Souza, CRO-SP 12345" });
  });
  it("vazio ou só espaço apaga", () => {
    expect(validarResponsavelTecnico("   ")).toEqual({ ok: true, linha: null });
    expect(validarResponsavelTecnico(undefined)).toEqual({ ok: true, linha: null });
  });
  it("recusa o que passa do tamanho", () => {
    expect(validarResponsavelTecnico("a".repeat(MAXIMO_RESPONSAVEL_TECNICO))).toMatchObject({ ok: true });
    expect(validarResponsavelTecnico("a".repeat(MAXIMO_RESPONSAVEL_TECNICO + 1))).toEqual({ ok: false, motivo: "longo" });
  });
  it("recusa link, endereço e arroba", () => {
    for (const t of ["Dra. Ana https://x.com", "Dra. Ana www.clinica.com", "Dra. Ana @clinica", "Dra. Ana clinica.com.br"]) {
      expect(validarResponsavelTecnico(t)).toEqual({ ok: false, motivo: "link" });
    }
  });
  it("recusa colchete", () => {
    expect(validarResponsavelTecnico("Dra. [nome]")).toEqual({ ok: false, motivo: "colchete" });
  });
});
