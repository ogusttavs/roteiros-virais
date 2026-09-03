import { describe, expect, it } from "vitest";

import { segmentosPreenchidos } from "./progressoSegmentos";

describe("segmentosPreenchidos", () => {
  it("marca preenchidos so ate o atual", () => {
    expect(segmentosPreenchidos(2, 5)).toEqual([true, true, false, false, false]);
  });

  it("zero preenchido quando atual e zero", () => {
    expect(segmentosPreenchidos(0, 5)).toEqual([false, false, false, false, false]);
  });

  it("todos preenchidos quando atual bate o total", () => {
    expect(segmentosPreenchidos(5, 5)).toEqual([true, true, true, true, true]);
  });
});
