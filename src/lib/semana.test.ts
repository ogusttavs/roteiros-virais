import { describe, expect, it } from "vitest";

import { segundaFeiraIso } from "./semana";

describe("segundaFeiraIso", () => {
  it("segunda-feira devolve ela mesma", () => {
    expect(segundaFeiraIso(new Date("2026-08-31T12:00:00Z"))).toBe("2026-08-31");
  });

  it("dia no meio da semana devolve a segunda-feira anterior", () => {
    expect(segundaFeiraIso(new Date("2026-09-02T12:00:00Z"))).toBe("2026-08-31");
  });

  it("domingo devolve a segunda-feira da mesma semana (a anterior no calendario)", () => {
    expect(segundaFeiraIso(new Date("2026-09-06T12:00:00Z"))).toBe("2026-08-31");
  });

  it("job rodando domingo 05:00 de Brasilia (08:00 UTC) fecha na segunda daquela semana", () => {
    expect(segundaFeiraIso(new Date("2026-09-06T08:00:00Z"))).toBe("2026-08-31");
  });

  it("madrugada UTC de segunda que ainda e domingo em Brasilia conta como a semana anterior", () => {
    expect(segundaFeiraIso(new Date("2026-09-07T01:00:00Z"))).toBe("2026-08-31");
  });
});
