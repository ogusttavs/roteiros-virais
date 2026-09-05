import { describe, expect, it } from "vitest";

import { deveInicializarSentry } from "./sentry";

describe("deveInicializarSentry", () => {
  it("nao inicia sem SENTRY_DSN (etapa 13: a VPS ainda nao tem essa conta)", () => {
    expect(deveInicializarSentry("")).toBe(false);
  });

  it("inicia quando o DSN existe", () => {
    expect(deveInicializarSentry("https://exemplo@o0.ingest.sentry.io/0")).toBe(true);
  });
});
