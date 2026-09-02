import { defineConfig, devices } from "@playwright/test";

const porta = 3000;
const baseURL = `http://localhost:${porta}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
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
     */
    env: { AI_PROVIDER: "mock" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
