import { describe, expect, it } from "vitest";

import { config, ErroConfiguracao, hojeISO, verificarSegredosDeProducao } from "./config";

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

  it("nao faz nada durante `next build`, mesmo com os valores padrao", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        BETTER_AUTH_SECRET: "troque-em-producao",
        JOBS_API_KEY: "troque-em-producao",
      }),
    ).not.toThrow();
  });

  it("MODO_E2E=1 com APP_URL e BETTER_AUTH_URL em localhost: passa", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        ...segredosDeVerdade,
        MODO_E2E: "1",
        APP_URL: "http://localhost:3100",
        BETTER_AUTH_URL: "http://localhost:3100",
      }),
    ).not.toThrow();
  });

  it("MODO_E2E=1 com 127.0.0.1: passa", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        ...segredosDeVerdade,
        MODO_E2E: "1",
        APP_URL: "http://127.0.0.1:3100",
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      }),
    ).not.toThrow();
  });

  it("MODO_E2E=1 com APP_URL fora de localhost: recusa (a flag nunca pode valer na VPS)", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        ...segredosDeVerdade,
        MODO_E2E: "1",
        APP_URL: "https://app.srv1953618.hstgr.cloud",
        BETTER_AUTH_URL: "http://localhost:3100",
      }),
    ).toThrow(ErroConfiguracao);
  });

  it("MODO_E2E=1 sem APP_URL nenhuma: recusa", () => {
    expect(() =>
      verificarSegredosDeProducao({ NODE_ENV: "production", ...segredosDeVerdade, MODO_E2E: "1" }),
    ).toThrow(ErroConfiguracao);
  });

  it("sem MODO_E2E, APP_URL fora de localhost passa normalmente (e a producao de verdade)", () => {
    expect(() =>
      verificarSegredosDeProducao({
        NODE_ENV: "production",
        ...segredosDeVerdade,
        APP_URL: "https://app.srv1953618.hstgr.cloud",
        BETTER_AUTH_URL: "https://app.srv1953618.hstgr.cloud",
      }),
    ).not.toThrow();
  });

  describe("E22: a cobranca ligada em producao", () => {
    const base = { NODE_ENV: "production", ...segredosDeVerdade };
    it("COBRANCA_ATIVA=1 sem STRIPE_SECRET_KEY recusa", () => {
      expect(() => verificarSegredosDeProducao({ ...base, COBRANCA_ATIVA: "1", STRIPE_WEBHOOK_SECRET: "whsec_x" })).toThrow(/STRIPE_SECRET_KEY/);
    });
    it("COBRANCA_ATIVA=1 sem STRIPE_WEBHOOK_SECRET recusa", () => {
      expect(() => verificarSegredosDeProducao({ ...base, COBRANCA_ATIVA: "1", STRIPE_SECRET_KEY: "rk_live_x" })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });
    it("COBRANCA_ATIVA=1 com as duas passa", () => {
      expect(() => verificarSegredosDeProducao({ ...base, COBRANCA_ATIVA: "1", STRIPE_SECRET_KEY: "rk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x" })).not.toThrow();
    });
    it("desligada (ausente, vazia ou diferente de 1) nao exige nada", () => {
      for (const valor of [undefined, "", "0", "true"]) {
        expect(() => verificarSegredosDeProducao({ ...base, COBRANCA_ATIVA: valor })).not.toThrow();
      }
    });
  });

  describe("E19: a ligacao do Instagram em producao", () => {
    const base = { NODE_ENV: "production", ...segredosDeVerdade };
    const chaveBase64 = Buffer.alloc(32, 7).toString("base64");
    const chaveHex = Buffer.alloc(32, 9).toString("hex");
    const completa = { META_APP_ID: "123", META_APP_SECRET: "segredo-do-app", META_LOGIN_CONFIG_ID: "456", META_TOKEN_CHAVE: chaveBase64 };

    it("sem nenhum dos dados da ligacao, nao exige nada (desligada)", () => {
      expect(() => verificarSegredosDeProducao(base)).not.toThrow();
    });
    it("com os quatro e a chave de 32 bytes em base64, passa", () => {
      expect(() => verificarSegredosDeProducao({ ...base, ...completa })).not.toThrow();
    });
    it("com a chave em 64 caracteres hexadecimais, passa", () => {
      expect(() => verificarSegredosDeProducao({ ...base, ...completa, META_TOKEN_CHAVE: chaveHex })).not.toThrow();
    });
    it("com qualquer um dos quatro faltando, recusa", () => {
      for (const faltando of ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_TOKEN_CHAVE"] as const) {
        const parcial = { ...completa, [faltando]: "" };
        expect(() => verificarSegredosDeProducao({ ...base, ...parcial }), faltando).toThrow(/juntos/);
      }
    });
    it("so a chave preenchida tambem recusa (a ligacao pela metade)", () => {
      expect(() => verificarSegredosDeProducao({ ...base, META_TOKEN_CHAVE: chaveBase64 })).toThrow(/juntos/);
    });
    it("chave que nao tem 32 bytes recusa, sem repetir o valor na mensagem", () => {
      for (const ruim of ["curta", Buffer.alloc(16, 1).toString("base64"), "z".repeat(64), Buffer.alloc(33, 1).toString("base64")]) {
        let mensagem = "";
        try {
          verificarSegredosDeProducao({ ...base, ...completa, META_TOKEN_CHAVE: ruim });
        } catch (erro) {
          mensagem = (erro as Error).message;
        }
        expect(mensagem, ruim).toMatch(/META_TOKEN_CHAVE precisa ter 32 bytes/);
        expect(mensagem).not.toContain(ruim);
      }
    });
    it("fora de producao nao confere nada", () => {
      expect(() => verificarSegredosDeProducao({ NODE_ENV: "development", META_TOKEN_CHAVE: "curta" })).not.toThrow();
    });
  });

  describe("E19b: a ligacao pelo Login do Instagram em producao (variaveis juntas ou nenhuma)", () => {
    const base = { NODE_ENV: "production", ...segredosDeVerdade };
    const chaveBase64 = Buffer.alloc(32, 7).toString("base64");
    const completa = { META_IG_APP_ID: "990602627938098", META_IG_APP_SECRET: "segredo-do-app-do-instagram", META_TOKEN_CHAVE: chaveBase64 };

    it("com as duas do Instagram e a chave de 32 bytes, passa; sem nenhuma, desligada, tambem", () => {
      expect(() => verificarSegredosDeProducao({ ...base, ...completa })).not.toThrow();
      expect(() => verificarSegredosDeProducao(base)).not.toThrow();
    });
    it("com qualquer uma das tres faltando, recusa", () => {
      for (const faltando of ["META_IG_APP_ID", "META_IG_APP_SECRET", "META_TOKEN_CHAVE"] as const) {
        const parcial = { ...completa, [faltando]: "" };
        expect(() => verificarSegredosDeProducao({ ...base, ...parcial }), faltando).toThrow(/juntos/);
      }
    });
    it("a chave sozinha, ou fraca, recusa", () => {
      expect(() => verificarSegredosDeProducao({ ...base, META_TOKEN_CHAVE: chaveBase64 })).toThrow(/juntos/);
      expect(() => verificarSegredosDeProducao({ ...base, ...completa, META_TOKEN_CHAVE: "curta" })).toThrow(/META_TOKEN_CHAVE precisa ter 32 bytes/);
    });
    it("as duas vias juntas passam, desde que cada uma esteja inteira", () => {
      const facebook = { META_APP_ID: "123", META_APP_SECRET: "s", META_LOGIN_CONFIG_ID: "456" };
      expect(() => verificarSegredosDeProducao({ ...base, ...completa, ...facebook })).not.toThrow();
      expect(() => verificarSegredosDeProducao({ ...base, ...completa, META_APP_ID: "123" })).toThrow(/juntos/);
    });
  });
});

describe("config.cobranca (o portao desligado por padrao e a porta de teste)", () => {
  it("nos testes o provedor e sempre o simulado, mesmo com a chave do Stripe no .env", () => {
    expect(config.cobranca.provedor).toBe("mock");
  });
  it("a chave de busca do preco e a do plano trimestral", () => {
    expect(config.cobranca.precoLookupKey).toBe("roteiros_trimestral");
  });
});
