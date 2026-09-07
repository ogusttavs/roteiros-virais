import { describe, expect, it } from "vitest";

import { diasDesde, formatarMultiplo, formatarViewsCompacto, formatarViewsExato } from "./formatarNumero";

describe("formatarViewsCompacto", () => {
  it("arredonda para mil e milhão em português", () => {
    expect(formatarViewsCompacto(12000)).toBe("12 mil");
    expect(formatarViewsCompacto(1200)).toBe("1,2 mil");
    expect(formatarViewsCompacto(999)).toBe("999");
    expect(formatarViewsCompacto(3400000)).toBe("3,4 mi");
  });
});

describe("formatarViewsExato", () => {
  it("usa ponto como separador de milhar", () => {
    expect(formatarViewsExato(1240)).toBe("1.240");
    expect(formatarViewsExato(12)).toBe("12");
  });
});

describe("formatarMultiplo", () => {
  it("sempre uma casa decimal e o x", () => {
    expect(formatarMultiplo(4.1)).toBe("4,1x");
    expect(formatarMultiplo(2)).toBe("2,0x");
  });
});

describe("diasDesde", () => {
  it("zero no mesmo dia, ignora hora", () => {
    const hoje = new Date(2026, 8, 7, 23, 0);
    expect(diasDesde(new Date(2026, 8, 7, 1, 0), hoje)).toBe(0);
  });

  it("conta dias corridos de calendario", () => {
    const hoje = new Date(2026, 8, 7, 8, 0);
    expect(diasDesde(new Date(2026, 8, 5, 20, 0), hoje)).toBe(2);
  });
});
