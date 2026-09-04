import { describe, expect, it } from "vitest";

import { ResetProibidoError, verificarAmbienteSeguro } from "./resetar-schema";

const BASE = { DATABASE_URL: "postgres://roteiros:roteiros@localhost:5432/roteiros_teste" };

describe("verificarAmbienteSeguro", () => {
  it("permite localhost", () => {
    expect(() => verificarAmbienteSeguro(BASE)).not.toThrow();
  });

  it("permite 127.0.0.1", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/roteiros_teste" }),
    ).not.toThrow();
  });

  it("permite o host postgres do compose", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@postgres:5432/roteiros_ci" }),
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

  it("recusa o banco de trabalho roteiros, mesmo em host local (etapa 11, ajuste 1)", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@localhost:5432/roteiros" }),
    ).toThrow(ResetProibidoError);
  });

  it("permite qualquer nome com sufixo de roteiros_", () => {
    for (const nome of ["roteiros_teste", "roteiros_dev", "roteiros_revisao", "roteiros_ci"]) {
      expect(() =>
        verificarAmbienteSeguro({ DATABASE_URL: `postgres://u:p@localhost:5432/${nome}` }),
      ).not.toThrow();
    }
  });

  it("permite o banco postgres, usado pela CI", () => {
    expect(() =>
      verificarAmbienteSeguro({ DATABASE_URL: "postgres://u:p@localhost:5432/postgres" }),
    ).not.toThrow();
  });
});
