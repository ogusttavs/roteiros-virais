import { describe, expect, it } from "vitest";

import { temposDeQuadro } from "./quadros";

describe("temposDeQuadro", () => {
  it("video de 9s: oito instantes, fixos e proporcionais, nenhum alem da duracao", () => {
    const tempos = temposDeQuadro(9);
    expect(tempos).toEqual([0.5, 2, 4, 1.35, 2.7, 4.05, 5.4, 6.75]);
    for (const t of tempos) expect(t).toBeLessThanOrEqual(9 - 0.1);
  });

  it("video de 35s: proporcionais batem com 15/30/45/60/75% da duracao", () => {
    const tempos = temposDeQuadro(35);
    expect(tempos).toEqual([0.5, 2, 4, 5.25, 10.5, 15.75, 21, 26.25]);
  });

  it("video de 180s: nenhum instante ultrapassa a duracao", () => {
    const tempos = temposDeQuadro(180);
    expect(tempos).toEqual([0.5, 2, 4, 27, 54, 81, 108, 135]);
    for (const t of tempos) expect(t).toBeLessThanOrEqual(180 - 0.1);
  });

  it("video curto demais (3s) recorta os instantes fixos que passariam do fim", () => {
    const tempos = temposDeQuadro(3);
    expect(tempos).toHaveLength(8);
    for (const t of tempos) expect(t).toBeLessThanOrEqual(3 - 0.1);
    expect(tempos[2]).toBe(2.9);
  });

  it("video de duracao zero nunca pede quadro negativo", () => {
    const tempos = temposDeQuadro(0);
    for (const t of tempos) expect(t).toBeGreaterThanOrEqual(0);
  });
});
