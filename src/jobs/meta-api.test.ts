import { describe, expect, it } from "vitest";

import { calcularEsperaMs, JANELA_MS } from "./meta-api";

describe("calcularEsperaMs", () => {
  it("meia janela ja passada, falta a outra metade", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T10:30:00Z");
    expect(calcularEsperaMs(maisAntiga, agora)).toBe(JANELA_MS / 2);
  });

  it("janela inteira ja passada, nada a esperar (nunca negativo)", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T12:00:00Z");
    expect(calcularEsperaMs(maisAntiga, agora)).toBe(0);
  });

  it("agora igual a mais antiga, falta a janela inteira", () => {
    const instante = new Date("2026-09-09T10:00:00Z");
    expect(calcularEsperaMs(instante, instante)).toBe(JANELA_MS);
  });

  it("respeita uma janela customizada", () => {
    const maisAntiga = new Date("2026-09-09T10:00:00Z");
    const agora = new Date("2026-09-09T10:00:05Z");
    expect(calcularEsperaMs(maisAntiga, agora, 10_000)).toBe(5_000);
  });
});
