import { describe, expect, it } from "vitest";

import { recenciaDaNoticia, saiuAgora } from "./recencia-da-noticia";

const AGORA = new Date("2026-11-25T15:00:00-03:00");
const antes = (ms: number) => new Date(AGORA.getTime() - ms);
const MIN = 60 * 1000;
const H = 60 * MIN;

describe("recenciaDaNoticia", () => {
  it("minutos, horas e dias, do jeito que se fala", () => {
    expect(recenciaDaNoticia(antes(40 * MIN), AGORA)).toBe("há 40 min");
    expect(recenciaDaNoticia(antes(10 * 1000), AGORA)).toBe("há 1 min");
    expect(recenciaDaNoticia(antes(59 * MIN), AGORA)).toBe("há 59 min");
    expect(recenciaDaNoticia(antes(60 * MIN), AGORA)).toBe("há 1 h");
    expect(recenciaDaNoticia(antes(3 * H), AGORA)).toBe("há 3 h");
    expect(recenciaDaNoticia(antes(23 * H + 59 * MIN), AGORA)).toBe("há 23 h");
  });

  it("depois de 24 horas conta pelo dia do calendário de São Paulo: ontem, anteontem, há N dias", () => {
    expect(recenciaDaNoticia(new Date("2026-11-24T10:00:00-03:00"), AGORA)).toBe("ontem");
    expect(recenciaDaNoticia(new Date("2026-11-23T10:00:00-03:00"), AGORA)).toBe("anteontem");
    expect(recenciaDaNoticia(new Date("2026-11-20T10:00:00-03:00"), AGORA)).toBe("há 5 dias");
  });

  it("sem data, texto vazio", () => {
    expect(recenciaDaNoticia(null, AGORA)).toBe("");
    expect(recenciaDaNoticia(new Date("x"), AGORA)).toBe("");
  });
});

describe("saiuAgora: o selo das de menos de 2 horas", () => {
  it("1h59 ganha o selo; 2h exatas e 1 dia não", () => {
    expect(saiuAgora(antes(1 * H + 59 * MIN), AGORA)).toBe(true);
    expect(saiuAgora(antes(2 * H), AGORA)).toBe(false);
    expect(saiuAgora(antes(24 * H), AGORA)).toBe(false);
    expect(saiuAgora(antes(5 * MIN), AGORA)).toBe(true);
  });

  it("sem data nunca ganha, e data adiantada demais (mais de 1 hora no futuro) também não", () => {
    expect(saiuAgora(null, AGORA)).toBe(false);
    expect(saiuAgora(new Date(AGORA.getTime() + 30 * MIN), AGORA)).toBe(true);
    expect(saiuAgora(new Date(AGORA.getTime() + 3 * H), AGORA)).toBe(false);
  });
});
