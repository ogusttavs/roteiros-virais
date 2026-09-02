import { defineConfig, devices } from "@playwright/test";

/**
 * A 3000 costuma estar ocupada por outro projeto do Gustavo na mesma
 * maquina; reuseExistingServer abaixo reaproveitaria esse servidor errado
 * sem avisar. PLAYWRIGHT_PORT deixa rodar numa porta livre (etapa 5,
 * PROXIMO.md): `PLAYWRIGHT_PORT=3100 npm run test:e2e`.
 */
const porta = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${porta}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  /**
   * O padrao (5s) reprova em servidor de desenvolvimento frio: a primeira
   * visita a uma rota nova (ex.: /admin/clientes logo depois do login)
   * ainda compila a pagina sob demanda, e isso sozinho pode passar de 5s.
   */
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    /**
     * plataforma/CLAUDE.md: todo teste roda em mock. So vale para um
     * servidor novo, que este comando sobe; um `npm run dev` ja rodando na
     * porta e reusado do jeito que esta (reuseExistingServer acima), com o
     * provedor que ele ja tinha.
     *
     * BETTER_AUTH_URL e APP_URL tambem seguem a porta: o better-auth recusa
     * request de uma origem diferente da configurada ("Invalid origin"), e
     * o .env local tem os dois fixos em localhost:3000.
     */
    env: {
      AI_PROVIDER: "mock",
      PORT: String(porta),
      BETTER_AUTH_URL: baseURL,
      APP_URL: baseURL,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
