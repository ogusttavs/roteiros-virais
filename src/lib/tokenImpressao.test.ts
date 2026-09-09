import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarTokenImpressao, validarTokenImpressao } from "./tokenImpressao";

describe("tokenImpressao", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aceita um token recem-criado para o mesmo roteiro, e devolve o clienteId", () => {
    const token = criarTokenImpressao(42, 7);
    expect(validarTokenImpressao(token, 42)).toEqual({ clienteId: 7 });
  });

  it("recusa quando o roteiroId da validacao e diferente do que assinou o token", () => {
    const token = criarTokenImpressao(42, 7);
    expect(validarTokenImpressao(token, 99)).toBeNull();
  });

  it("recusa token adulterado", () => {
    const token = criarTokenImpressao(42, 7);
    const adulterado = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(validarTokenImpressao(adulterado, 42)).toBeNull();
  });

  it("recusa depois de expirado (1 minuto)", () => {
    const token = criarTokenImpressao(42, 7);
    vi.advanceTimersByTime(60_001);
    expect(validarTokenImpressao(token, 42)).toBeNull();
  });

  it("recusa token malformado", () => {
    expect(validarTokenImpressao("qualquer-coisa", 42)).toBeNull();
    expect(validarTokenImpressao("", 42)).toBeNull();
  });
});
