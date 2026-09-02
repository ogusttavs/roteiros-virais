import { describe, expect, it } from "vitest";

import { hojeISO } from "./config";

describe("hojeISO", () => {
  it("formata no fuso de Sao Paulo, sem hora", () => {
    // 2026-03-01 02:30 UTC = 2026-02-28 23:30 em Sao Paulo (UTC-3)
    const data = new Date("2026-03-01T02:30:00Z");
    expect(hojeISO(data)).toBe("2026-02-28");
  });

  it("aceita meia-noite exata em Sao Paulo", () => {
    const data = new Date("2026-06-10T03:00:00Z");
    expect(hojeISO(data)).toBe("2026-06-10");
  });
});
