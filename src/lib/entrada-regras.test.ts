import { describe, expect, it } from "vitest";

import { normalizarEmail, provisoriaVencida, VALIDADE_DA_SENHA_PROVISORIA_EM_HORAS } from "./entrada-regras";

const HORA = 60 * 60 * 1000;

describe("a senha provisória vence em 48 horas", () => {
  const criadaEm = new Date("2026-11-26T12:00:00Z");

  it("vale até um instante antes das 48 horas", () => {
    expect(VALIDADE_DA_SENHA_PROVISORIA_EM_HORAS).toBe(48);
    expect(provisoriaVencida(criadaEm, criadaEm)).toBe(false);
    expect(provisoriaVencida(criadaEm, new Date(criadaEm.getTime() + 47 * HORA))).toBe(false);
    expect(provisoriaVencida(criadaEm, new Date(criadaEm.getTime() + 48 * HORA - 1))).toBe(false);
  });

  it("vence ao completar as 48 horas, e continua vencida depois", () => {
    expect(provisoriaVencida(criadaEm, new Date(criadaEm.getTime() + 48 * HORA))).toBe(true);
    expect(provisoriaVencida(criadaEm, new Date(criadaEm.getTime() + 30 * 24 * HORA))).toBe(true);
  });
});

describe("o e-mail dos freios", () => {
  it("é o mesmo endereço com maiúsculas ou espaço nas pontas", () => {
    expect(normalizarEmail("  Clinica@Exemplo.Teste ")).toBe("clinica@exemplo.teste");
  });
});
