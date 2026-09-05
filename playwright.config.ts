import { defineConfig, devices } from "@playwright/test";

/**
 * A 3000 costuma estar ocupada por outro projeto do Gustavo na mesma
 * maquina; reuseExistingServer abaixo reaproveitaria esse servidor errado
 * sem avisar. PLAYWRIGHT_PORT deixa rodar numa porta livre (etapa 5,
 * PROXIMO.md): `PLAYWRIGHT_PORT=3100 npm run test:e2e`.
 */
const porta = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${porta}`;

/**
 * Segredos de teste com 32 caracteres ou mais (etapa 13, parte 3, decisão 2
 * do `PROXIMO.md`): `next start` sempre roda com `NODE_ENV=production`
 * (diferente de `next dev`), e `verificarSegredosDeProducao`
 * (`src/lib/config.ts`) recusa iniciar em produção com o valor de exemplo
 * do `.env.example`. Só de teste, nunca os segredos reais.
 */
const SEGREDO_E2E = "e2e-teste-nao-e-producao-".padEnd(32, "0");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  /**
   * Mais de um arquivo de e2e reseta o schema inteiro no beforeAll (o mesmo
   * padrao dos testes de integracao do Vitest). Com mais de um worker, dois
   * arquivos rodando em paralelo podiam derrubar o schema um do outro no
   * meio do teste. Vitest resolve isso com fileParallelism: false no projeto
   * de integracao; aqui o equivalente e travar num worker so (etapa 5, parte
   * 2, achado ao acrescentar o segundo arquivo que toca o banco).
   */
  workers: 1,
  /**
   * Com um worker so, os arquivos de e2e rodam no mesmo processo Node, e
   * dividem o mesmo pool do Postgres (globalThis, src/db/index.ts). Fechar o
   * pool no afterAll de um arquivo quebrava o proximo arquivo no mesmo
   * worker. O teardown global fecha uma vez so, depois de todos os arquivos.
   */
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  forbidOnly: !!process.env.CI,
  /**
   * `retries: 1` em CI esconde corrida de teste (achado da revisão da etapa
   * 12, parte 1): toda falha que só aparece local, sob carga, e passa na
   * segunda tentativa é corrida de teste ou corrida de produto de verdade,
   * nunca "ambiente". Investigar a causa real em vez de confiar no retry.
   */
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
    /**
     * e2e contra build de producao (etapa 13, parte 3, decisao 2 do
     * `PROXIMO.md`): `next dev` recompila pagina sob demanda, a fonte de
     * toda oscilacao que este projeto ja viu; `next start` serve o build
     * pronto, igual ao Dockerfile de producao. Em CI, o build ja roda como
     * passo proprio antes deste arquivo (`PLAYWRIGHT_SEM_BUILD=1`), entao o
     * comando so inicia; localmente, builda e inicia toda vez que nao ha
     * servidor ja rodando na porta (reuseExistingServer abaixo).
     */
    command: process.env.PLAYWRIGHT_SEM_BUILD === "1" ? "npm run start" : "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    /**
     * plataforma/CLAUDE.md: todo teste roda em mock. So vale para um
     * servidor novo, que este comando sobe; um servidor ja rodando na
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
      BETTER_AUTH_SECRET: SEGREDO_E2E,
      JOBS_API_KEY: SEGREDO_E2E,
      /**
       * Achado ao rodar a suíte contra `next start`: o better-auth liga
       * sozinho, só em produção, um limite de 3 tentativas a cada 10 s em
       * `/sign-in*`, e mais de um spec entra pela mesma conta de exemplo em
       * sequência. Ver o comentário em `src/lib/config.ts`; nunca setar
       * isso fora deste arquivo.
       */
      DESABILITAR_LIMITE_DE_TAXA: "1",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
