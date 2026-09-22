import { describe, expect, it } from "vitest";

import { handleBateComUsername } from "./meta-ig-cliente";

describe("handleBateComUsername", () => {
  it("o mesmo handle, caixa igual, bate", () => {
    expect(handleBateComUsername("veluracosmetics", "veluracosmetics")).toBe(true);
  });

  it("Instagram nao diferencia caixa: bate mesmo com letras diferentes", () => {
    expect(handleBateComUsername("VeluraCosmetics", "veluracosmetics")).toBe(true);
    expect(handleBateComUsername("veluracosmetics", "VELURACOSMETICS")).toBe(true);
  });

  it("handles diferentes nao batem", () => {
    expect(handleBateComUsername("veluracosmetics", "outraconta")).toBe(false);
  });
});
