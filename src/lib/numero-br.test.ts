import { describe, expect, it } from "vitest";

import { lerNumeroBr } from "./numero-br";

describe("lerNumeroBr", () => {
  it("lê o jeito brasileiro e o dos teclados de fora sem errar a casa", () => {
    expect(lerNumeroBr("1.234,50")).toBe(1234.5);
    expect(lerNumeroBr("1234,5")).toBe(1234.5);
    expect(lerNumeroBr("20.50")).toBe(20.5);
    expect(lerNumeroBr("1.5")).toBe(1.5);
    expect(lerNumeroBr("1.234")).toBe(1234);
    expect(lerNumeroBr("1.234.567")).toBe(1234567);
    expect(lerNumeroBr("109")).toBe(109);
    expect(lerNumeroBr("0,5")).toBe(0.5);
  });

  it("o que não entende volta NaN", () => {
    for (const ruim of ["", "abc", "1,2,3", "1.2.3", "-5", "1e5"]) expect(Number.isNaN(lerNumeroBr(ruim))).toBe(true);
  });
});
