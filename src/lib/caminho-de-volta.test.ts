import { describe, expect, it } from "vitest";

import { caminhoDeVoltaValido } from "./caminho-de-volta";

describe("caminhoDeVoltaValido (o ?voltar= vem da barra de endereço)", () => {
  it("aceita um caminho de /criar/ com os parâmetros", () => {
    expect(caminhoDeVoltaValido("/criar/objetivo?tema=0")).toBe("/criar/objetivo?tema=0");
    expect(caminhoDeVoltaValido("/criar/objetivo?livre=como%20lavar%20o%20sof%C3%A1&data=2026-10-23")).toBe("/criar/objetivo?livre=como%20lavar%20o%20sof%C3%A1&data=2026-10-23");
    expect(caminhoDeVoltaValido("/criar/tema-livre")).toBe("/criar/tema-livre");
  });

  it("recusa o que não é caminho interno de /criar/: outro site, protocolo, //, barra invertida, outra área do aplicativo", () => {
    for (const ruim of [
      "https://exemplo.com/criar/objetivo",
      "//exemplo.com/criar/objetivo",
      "/\\exemplo.com",
      "/criar/\\exemplo.com",
      "javascript:alert(1)",
      "/hoje",
      "/criar",
      "criar/objetivo",
      "/admin/clientes",
      "/criar/../hoje",
      "/criar/%2e%2e/hoje",
      "",
    ]) {
      expect(caminhoDeVoltaValido(ruim), ruim).toBeNull();
    }
    expect(caminhoDeVoltaValido(null)).toBeNull();
    expect(caminhoDeVoltaValido(undefined)).toBeNull();
  });

  it("recusa caractere de controle e valor longo demais", () => {
    expect(caminhoDeVoltaValido("/criar/objetivo?x=\n1")).toBeNull();
    expect(caminhoDeVoltaValido(`/criar/objetivo?x=${"a".repeat(2000)}`)).toBeNull();
  });
});
