import { describe, expect, it } from "vitest";

import { calcularCustoUsd } from "./registro";

describe("calcularCustoUsd", () => {
  it("calcula uma chamada forte sem cache", () => {
    // 1000 tokens de entrada a US$5/1M + 500 de saida a US$25/1M
    const custo = calcularCustoUsd("forte", {
      tokensEntrada: 1000,
      tokensSaida: 500,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    });
    expect(custo).toBeCloseTo(1000 * (5 / 1_000_000) + 500 * (25 / 1_000_000), 10);
  });

  it("calcula uma chamada barata com cache de leitura e de escrita", () => {
    const custo = calcularCustoUsd("barato", {
      tokensEntrada: 200,
      tokensSaida: 100,
      tokensCacheLeitura: 5000,
      tokensCacheEscrita: 1000,
    });
    const esperado =
      200 * (1 / 1_000_000) +
      1000 * (1 / 1_000_000) * 1.25 +
      5000 * (1 / 1_000_000) * 0.1 +
      100 * (5 / 1_000_000);
    expect(custo).toBeCloseTo(esperado, 10);
  });

  it("divide por dois numa chamada em lote", () => {
    const uso = {
      tokensEntrada: 1000,
      tokensSaida: 500,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    };
    const custoNormal = calcularCustoUsd("barato", uso);
    const custoLote = calcularCustoUsd("barato", uso, true);
    expect(custoLote).toBeCloseTo(custoNormal / 2, 10);
  });

  it("custo zero para uso zero (chamada em mock)", () => {
    const custo = calcularCustoUsd("forte", {
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    });
    expect(custo).toBe(0);
  });
});
