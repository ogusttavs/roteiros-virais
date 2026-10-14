/**
 * A causa do erro da API da IA (achado de 05/10/2026): crédito, sobrecarga e chave recusada são ditos pelo nome ao admin e só a ele; o cliente comum e o erro sem causa ficam com a frase genérica.
 */
import { APIError, AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { traduzirErro } from "./cliente";
import { causaDoErroDaApi, ErroIA, FRASE_DA_CAUSA_PARA_ADMIN, FRASE_GENERICA_DO_CLIENTE, fraseDoErroDaIA } from "./erro";

function erroDaApi(status: number, mensagem: string): APIError {
  return APIError.generate(status, { type: "error", error: { type: "x", message: mensagem } }, mensagem, new Headers());
}

describe("causaDoErroDaApi", () => {
  it.each([
    ["a mensagem de crédito baixo, com status 400 (como a Anthropic devolve)", 400, "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing", "credito"],
    ["o status 402", 402, "payment required", "credito"],
    ["fundos insuficientes", 400, "Insufficient funds", "credito"],
    ["a chave recusada (401)", 401, "invalid x-api-key", "chave"],
    ["o limite de taxa (429)", 429, "rate limit", "sobrecarga"],
    ["a API sobrecarregada (529)", 529, "Overloaded", "sobrecarga"],
    ["a mensagem de sobrecarga sem status", undefined, "Overloaded", "sobrecarga"],
  ])("%s", (_nome, status, mensagem, esperada) => {
    expect(causaDoErroDaApi(status, mensagem)).toBe(esperada);
  });

  it("o crédito manda antes do número: um 429 ou 401 que fala de crédito é crédito", () => {
    expect(causaDoErroDaApi(429, "credit balance is too low")).toBe("credito");
    expect(causaDoErroDaApi(401, "credit balance is too low")).toBe("credito");
  });

  it.each([
    ["um 400 de schema", 400, "output_config.format invalid"],
    ["um 500", 500, "internal server error"],
    ["um 404", 404, "not found"],
    ["sem status e sem causa", undefined, "algo deu errado"],
    ["um 403 de permissão (modelo ou ferramenta sem acesso), que não é a chave", 403, "permission denied"],
    ["um 400 que só cita a palavra billing", 400, "invalid parameter: billing_address"],
  ])("%s não tem causa para o admin", (_nome, status, mensagem) => {
    expect(causaDoErroDaApi(status, mensagem)).toBeNull();
  });
});

describe("traduzirErro leva a causa", () => {
  it("o erro de crédito do SDK vira ErroIA com a causa crédito, e o texto técnico não vira a frase da tela", () => {
    const erro = traduzirErro(erroDaApi(400, "Your credit balance is too low to access the Anthropic API."), "roteiro");
    expect(erro).toBeInstanceOf(ErroIA);
    expect(erro.causa).toBe("credito");
    expect(erro.message).toContain("credit balance");
    expect(erro.mensagemCliente).toBe(FRASE_GENERICA_DO_CLIENTE);
  });

  it("o limite de taxa vira sobrecarga, mesmo sem a palavra na mensagem", () => {
    const erro = traduzirErro(new RateLimitError(429, undefined, "slow down", new Headers()), "roteiro");
    expect(erro.causa).toBe("sobrecarga");
  });

  it("a chave recusada do SDK vira a causa chave", () => {
    const erro = traduzirErro(new AuthenticationError(401, undefined, "invalid x-api-key", new Headers()), "roteiro");
    expect(erro.causa).toBe("chave");
  });

  it("a API sobrecarregada (529) vira sobrecarga", () => {
    expect(traduzirErro(erroDaApi(529, "Overloaded"), "roteiro").causa).toBe("sobrecarga");
  });

  it("o erro sem causa conhecida (500, 400 de schema, erro inesperado) fica sem causa", () => {
    expect(traduzirErro(erroDaApi(500, "internal"), "roteiro").causa).toBeNull();
    expect(traduzirErro(erroDaApi(400, "schema"), "roteiro").causa).toBeNull();
    expect(traduzirErro(new Error("quebrou"), "roteiro").causa).toBeNull();
  });
});

describe("fraseDoErroDaIA", () => {
  it("o admin lê a causa pelo nome; o cliente comum, a frase genérica", () => {
    const credito = new ErroIA("credit balance", undefined, "credito");
    expect(fraseDoErroDaIA(credito, true)).toBe("A API da IA está sem crédito. Recarregue em Plans & Billing da Anthropic.");
    expect(fraseDoErroDaIA(credito, false)).toBe(FRASE_GENERICA_DO_CLIENTE);
    expect(fraseDoErroDaIA(new ErroIA("529", undefined, "sobrecarga"), true)).toBe("A IA está sobrecarregada, tente em um minuto.");
    expect(fraseDoErroDaIA(new ErroIA("401", undefined, "chave"), true)).toContain("A chave da IA foi recusada");
  });

  it("o erro sem causa fica com a frase dele para todo mundo, inclusive o admin", () => {
    expect(fraseDoErroDaIA(new ErroIA("saida truncada"), true)).toBe(FRASE_GENERICA_DO_CLIENTE);
    expect(fraseDoErroDaIA(new ErroIA("recusa", "Frase própria do erro."), true)).toBe("Frase própria do erro.");
  });

  it("as frases do admin não levam o texto cru da API, nem travessão nem emoji", () => {
    for (const frase of Object.values(FRASE_DA_CAUSA_PARA_ADMIN)) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(frase).not.toMatch(/x-api-key|credit balance|status|\b\d{3}\b/i);
    }
  });
});

describe("os marcadores do simulador", () => {
  it("valem fora de produção, e em produção só com o modo e2e: um texto de cliente nunca aciona a falha num app que caiu no mock por omissão", async () => {
    const { erroDeCausaSimulado } = await import("./mock");
    expect(erroDeCausaSimulado("o momento [mock:erro-credito]")?.causa).toBe("credito");
    expect(erroDeCausaSimulado("o momento [mock:erro-sobrecarga]")?.causa).toBe("sobrecarga");
    expect(erroDeCausaSimulado("o momento [mock:erro-chave]")?.causa).toBe("chave");
    expect(erroDeCausaSimulado("um momento qualquer")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(erroDeCausaSimulado("o momento [mock:erro-credito]")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
