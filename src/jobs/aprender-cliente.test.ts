/**
 * `pareceRegraDesativada` (item 4 do acabamento da E27): uma regra desativada nao volta com
 * outra redacao. Funcao pura, sem banco nem IA.
 */
import { describe, expect, it } from "vitest";

import { pareceRegraDesativada } from "./aprender-cliente";

describe("pareceRegraDesativada", () => {
  it("mesma frase, mesmo motivo: bloqueia", () => {
    const desativadas = [{ regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "gancho_fraco" }];
    const proposta = { regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "gancho_fraco" };

    expect(pareceRegraDesativada(proposta, desativadas)).toBe(true);
  });

  it("redacao parecida, mesmo motivo: bloqueia (Jaccard >= 0,5 nas palavras de 4+ letras)", () => {
    const desativadas = [{ regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "gancho_fraco" }];
    const proposta = { regra: "mostre o resultado primeiro, nunca comece com pergunta", motivoOrigem: "gancho_fraco" };

    expect(pareceRegraDesativada(proposta, desativadas)).toBe(true);
  });

  it("redacao bem diferente, mesmo motivo, mas sem palavras suficientes em comum: deixa passar", () => {
    const desativadas = [{ regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "gancho_fraco" }];
    const proposta = { regra: "grave em ambiente claro e use roupa neutra", motivoOrigem: "gancho_fraco" };

    expect(pareceRegraDesativada(proposta, desativadas)).toBe(false);
  });

  it("motivo diferente: nao bloqueia mesmo com a frase identica", () => {
    const desativadas = [{ regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "gancho_fraco" }];
    const proposta = { regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "muito_longo" };

    expect(pareceRegraDesativada(proposta, desativadas)).toBe(false);
  });

  it("proposta sem motivo (nulo): so a frase conta, bloqueia mesmo contra uma desativada com motivo", () => {
    const desativadas = [{ regra: "nao comece com pergunta, mostre o resultado primeiro", motivoOrigem: "gancho_fraco" }];
    const proposta = { regra: "mostre o resultado primeiro, nunca comece com pergunta", motivoOrigem: null };

    expect(pareceRegraDesativada(proposta, desativadas)).toBe(true);
  });

  it("sem nenhuma regra desativada: nunca bloqueia", () => {
    expect(pareceRegraDesativada({ regra: "qualquer regra", motivoOrigem: null }, [])).toBe(false);
  });
});
