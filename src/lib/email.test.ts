import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  config: { email: { resendKey: "", de: "painel@localhost" } },
}));

import { enviarEmail, ErroEmail } from "./email";

describe("enviarEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
});
