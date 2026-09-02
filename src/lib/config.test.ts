import { describe, expect, it } from "vitest";

import { ErroConfiguracao, hojeISO, verificarSegredosDeProducao } from "./config";

describe("hojeISO", () => {
  it("formata no fuso de Sao Paulo, sem hora", () => {
    // 2026-03-01 02:30 UTC = 2026-02-28 23:30 em Sao Paulo (UTC-3)
    const data = new Date("2026-03-01T02:30:00Z");
    expect(hojeISO(data)).toBe("2026-02-28");
  });

  it("aceita meia-noite exata em Sao Paulo", () => {
    const data = new Date("2026-06-10T03:00:00Z");
    expect(hojeISO(data)).toBe("2026-06-10");
  });
});

describe("verificarSegredosDeProducao", () => {
  const segredosDeVerdade = {
    BETTER_AUTH_SECRET: "algo-gerado-de-verdade",
    JOBS_API_KEY: "outro-gerado-de-verdade",
  };

  it("nao faz nada fora de producao, mesmo com os valores padrao", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: "troque-em-producao",
        JOBS_API_KEY: "troque-em-producao",
      }),
    ).not.toThrow();
  });

  it("passa em producao com segredos de verdade", () => {
    expect(() =>
      verificarSegredosDeProducao({ NODE_ENV: "production", ...segredosDeVerdade }),
    ).not.toThrow();
  });

  it("recusa em producao com BETTER_AUTH_SECRET padrao", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "troque-em-producao",
        JOBS_API_KEY: segredosDeVerdade.JOBS_API_KEY,
      }),
    ).toThrow(ErroConfiguracao);
  });

  it("recusa em producao com JOBS_API_KEY padrao", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: segredosDeVerdade.BETTER_AUTH_SECRET,
        JOBS_API_KEY: "troque-em-producao",
      }),
    ).toThrow(ErroConfiguracao);
  });

  it("recusa em producao sem nenhum dos dois definido", () => {
    expect(() => verificarSegredosDeProducao({ NODE_ENV: "production" })).toThrow(ErroConfiguracao);
  });
});
