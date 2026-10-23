import { describe, expect, it } from "vitest";

import { DIAS_MAXIMOS_DA_NOTICIA, inicioDaJanelaDeNoticias, noticiaEhCandidata } from "./janela-de-noticias";

const AGORA = new Date("2026-10-22T12:00:00Z");
const dias = (n: number) => new Date(AGORA.getTime() - n * 24 * 60 * 60 * 1000);

describe("noticiaEhCandidata (a janela de 7 dias)", () => {
  it("a janela é de 7 dias", () => {
    expect(DIAS_MAXIMOS_DA_NOTICIA).toBe(7);
    expect(inicioDaJanelaDeNoticias(AGORA).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });

  it("de hoje, de ontem e de seis dias atrás entram", () => {
    expect(noticiaEhCandidata(dias(0), AGORA)).toBe(true);
    expect(noticiaEhCandidata(dias(1), AGORA)).toBe(true);
    expect(noticiaEhCandidata(dias(6), AGORA)).toBe(true);
  });

  it("de mais de 7 dias não entra (a de dezembro que o Google News devolve)", () => {
    expect(noticiaEhCandidata(dias(7.01), AGORA)).toBe(false);
    expect(noticiaEhCandidata(dias(30), AGORA)).toBe(false);
    expect(noticiaEhCandidata(new Date("2025-12-10T10:00:00Z"), AGORA)).toBe(false);
  });

  it("sem data, ou com data inválida, não entra", () => {
    expect(noticiaEhCandidata(null, AGORA)).toBe(false);
    expect(noticiaEhCandidata(undefined, AGORA)).toBe(false);
    expect(noticiaEhCandidata(new Date("lixo"), AGORA)).toBe(false);
  });

  it("data adiantada em algumas horas (fuso) entra; adiantada em dias é data errada", () => {
    expect(noticiaEhCandidata(new Date(AGORA.getTime() + 3 * 60 * 60 * 1000), AGORA)).toBe(true);
    expect(noticiaEhCandidata(new Date(AGORA.getTime() + 3 * 24 * 60 * 60 * 1000), AGORA)).toBe(false);
  });
});
