/**
 * M4, item 6: `sugerirEstiloPelaEvidencia` (item 2) é pura, por isso teste unitário direto, sem
 * banco. Maioria sem fala sugere sem fala; maioria falada ou empate vale falado; sem evidência
 * nenhuma também vale falado (nada para sugerir a partir dela).
 */
import { describe, expect, it } from "vitest";

import { sugerirEstiloPelaEvidencia } from "./enums";

describe("sugerirEstiloPelaEvidencia", () => {
  it("sem evidencia nenhuma, sugere falado", () => {
    expect(sugerirEstiloPelaEvidencia([])).toBe("falado");
  });

  it("maioria sem fala (2 de 3), sugere sem fala", () => {
    const evidencias = [{ semFala: true }, { semFala: true }, { semFala: false }];
    expect(sugerirEstiloPelaEvidencia(evidencias)).toBe("sem_fala");
  });

  it("maioria falada (2 de 3), sugere falado", () => {
    const evidencias = [{ semFala: false }, { semFala: false }, { semFala: true }];
    expect(sugerirEstiloPelaEvidencia(evidencias)).toBe("falado");
  });

  it("empate (metade e metade) vale falado", () => {
    const evidencias = [{ semFala: true }, { semFala: false }];
    expect(sugerirEstiloPelaEvidencia(evidencias)).toBe("falado");
  });

  it("evidencia sem a informacao (nulo ou ausente) conta como falado", () => {
    const evidencias = [{ semFala: null }, { semFala: undefined }, { semFala: true }];
    expect(sugerirEstiloPelaEvidencia(evidencias)).toBe("falado");
  });

  it("unanime sem fala, sugere sem fala", () => {
    const evidencias = [{ semFala: true }, { semFala: true }];
    expect(sugerirEstiloPelaEvidencia(evidencias)).toBe("sem_fala");
  });
});
