import { describe, expect, it } from "vitest";

import { PRECO_GROQ_USD_POR_HORA, precoApifyPorMilResultados, SEGUNDOS_MINIMOS_COBRADOS_GROQ } from "@/config/precos-ia";

import { custoDaTranscricaoGroqUsd, custoEstimadoDoApifyUsd } from "./custos-externos";

describe("custo da Groq", () => {
  it("um minuto de áudio custa um sessenta avos da hora", () => {
    expect(custoDaTranscricaoGroqUsd(60)).toBeCloseTo(PRECO_GROQ_USD_POR_HORA / 60, 10);
  });

  it("áudio mais curto que o mínimo cobrado paga o mínimo de 10 segundos", () => {
    expect(custoDaTranscricaoGroqUsd(2)).toBeCloseTo((SEGUNDOS_MINIMOS_COBRADOS_GROQ / 3600) * PRECO_GROQ_USD_POR_HORA, 10);
    expect(custoDaTranscricaoGroqUsd(0)).toBe(custoDaTranscricaoGroqUsd(SEGUNDOS_MINIMOS_COBRADOS_GROQ));
  });
});

describe("custo estimado do Apify", () => {
  it("usa o preço por mil resultados de cada ator", () => {
    expect(precoApifyPorMilResultados("clockworks/tiktok-scraper")).toBe(1.7);
    expect(precoApifyPorMilResultados("apify/instagram-scraper")).toBe(2.7);
    expect(custoEstimadoDoApifyUsd("clockworks/tiktok-scraper", 500)).toBeCloseTo(0.85, 10);
  });

  it("um ator desconhecido usa o preço padrão, e zero resultado custa zero", () => {
    expect(precoApifyPorMilResultados("outro/ator")).toBe(2.2);
    expect(custoEstimadoDoApifyUsd("apify/instagram-scraper", 0)).toBe(0);
  });
});
