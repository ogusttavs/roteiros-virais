import { describe, expect, it } from "vitest";

import { montarCampoOnde } from "./onde";

describe("montarCampoOnde", () => {
  it("brasil nunca leva regiao, pais ou paises, mesmo se os campos tiverem texto", () => {
    expect(montarCampoOnde("brasil", "Campinas", "Estados Unidos", "Estados Unidos e México")).toEqual({
      alcance: "brasil",
      regiao: undefined,
      pais: undefined,
      paises: undefined,
    });
  });

  it("local leva a regiao escrita, nunca pais ou paises", () => {
    expect(montarCampoOnde("local", "Campinas e região", "Estados Unidos", "Estados Unidos e México")).toEqual({
      alcance: "local",
      regiao: "Campinas e região",
      pais: undefined,
      paises: undefined,
    });
  });

  it("outro_pais leva o pais escrito, nunca regiao ou paises", () => {
    expect(montarCampoOnde("outro_pais", "Campinas", "Estados Unidos", "Estados Unidos e México")).toEqual({
      alcance: "outro_pais",
      regiao: undefined,
      pais: "Estados Unidos",
      paises: undefined,
    });
  });

  it("mais_de_um_pais leva os paises escritos, nunca regiao ou pais", () => {
    expect(montarCampoOnde("mais_de_um_pais", "Campinas", "Estados Unidos", "Estados Unidos e México")).toEqual({
      alcance: "mais_de_um_pais",
      regiao: undefined,
      pais: undefined,
      paises: "Estados Unidos e México",
    });
  });
});
