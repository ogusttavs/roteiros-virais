import { describe, expect, it } from "vitest";

import { montarCampoOnde } from "./onde";

describe("montarCampoOnde", () => {
  it("brasil nunca leva regiao, mesmo se o campo tiver texto", () => {
    expect(montarCampoOnde("brasil", "Campinas")).toEqual({ alcance: "brasil", regiao: undefined });
  });

  it("local leva a regiao escrita", () => {
    expect(montarCampoOnde("local", "Campinas e região")).toEqual({ alcance: "local", regiao: "Campinas e região" });
  });
});
