import { describe, expect, it } from "vitest";

import { ResetProibidoError, verificarAmbienteSeguro } from "./resetar-schema";

const BASE = { DATABASE_URL: "postgres://roteiros:roteiros@localhost:5432/roteiros" };

describe("verificarAmbienteSeguro", () => {
  it("permite localhost", () => {
    expect(() => verificarAmbienteSeguro(BASE)).not.toThrow();
  });

  it("permite 127.0.0.1", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/roteiros" }),
    ).not.toThrow();
  });

  it("permite o host postgres do compose", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@postgres:5432/roteiros" }),
    ).not.toThrow();
  });

  it("recusa quando NODE_ENV e production", () => {
    expect(() => verificarAmbienteSeguro({ ...BASE, NODE_ENV: "production" })).toThrow(
      ResetProibidoError,
    );
  });

  it("recusa host que nao e local", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@meu-vps.exemplo.com:5432/roteiros" }),
    ).toThrow(ResetProibidoError);
  });

  it("recusa sem DATABASE_URL", () => {
    expect(() => verificarAmbienteSeguro({})).toThrow(ResetProibidoError);
  });

  it("recusa DATABASE_URL invalida", () => {
    expect(() => verificarAmbienteSeguro({ DATABASE_URL: "nao e uma url" })).toThrow(
      ResetProibidoError,
    );
  });
});
