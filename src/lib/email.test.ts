import { afterEach, describe, expect, it, vi } from "vitest";

const configMock = vi.hoisted(() => ({
  email: { resendKey: "", de: "painel@localhost" },
  modoE2E: false,
}));
vi.mock("./config", () => ({ config: configMock }));

import { enviarEmail, ErroEmail } from "./email";

describe("enviarEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    configMock.modoE2E = false;
  });

  it("fora de producao, cai no log mesmo sem chave", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(
      enviarEmail({ para: "a@teste.local", assunto: "oi", html: "<p>oi</p>" }),
    ).resolves.toBeUndefined();
  });

  it("em producao sem RESEND_API_KEY, lanca ErroEmail em vez de sumir no log", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      enviarEmail({ para: "a@teste.local", assunto: "oi", html: "<p>oi</p>" }),
    ).rejects.toThrow(ErroEmail);
  });

  it("em producao com modoE2E, cai no log em vez de mandar de verdade (achado da etapa 13, parte 3)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    configMock.modoE2E = true;
    await expect(
      enviarEmail({ para: "cliente-e2e@exemplo.teste", assunto: "oi", html: "<p>oi</p>" }),
    ).resolves.toBeUndefined();
  });
});
