import { describe, expect, it } from "vitest";

import { deveInicializarSentry, opcoesSentry } from "./sentry";

describe("deveInicializarSentry", () => {
  it("nao inicia sem SENTRY_DSN (etapa 13: a VPS ainda nao tem essa conta)", () => {
    expect(deveInicializarSentry("")).toBe(false);
  });

  it("inicia quando o DSN existe", () => {
    expect(deveInicializarSentry("https://exemplo@o0.ingest.sentry.io/0")).toBe(true);
  });
});

/**
 * E38 PR 2: o leitor de site pede páginas de sites de clientes. Sem a lista vazia, o Sentry anexaria
 * `sentry-trace` e `baggage` (release, ambiente, chave pública) a essa e a toda requisição de saída.
 */
describe("opcoesSentry", () => {
  it("não propaga o rastreio para nenhum endereço de saída", () => {
    expect(opcoesSentry().tracePropagationTargets).toEqual([]);
  });
});
