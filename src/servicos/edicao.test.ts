import { describe, expect, it } from "vitest";

import { inicioDoMesDeBrasilia } from "./edicao";

describe("inicioDoMesDeBrasilia", () => {
  it("o mês começa à meia-noite de Brasília (03:00 UTC)", () => {
    expect(inicioDoMesDeBrasilia(new Date("2026-10-29T15:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("a noite do último dia, em Brasília, ainda é do mês que acaba (mesmo já sendo o mês seguinte em UTC)", () => {
    expect(inicioDoMesDeBrasilia(new Date("2026-11-01T02:59:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(inicioDoMesDeBrasilia(new Date("2026-11-01T03:00:00Z")).toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("vira o ano", () => {
    expect(inicioDoMesDeBrasilia(new Date("2027-01-01T02:00:00Z")).toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });
});
