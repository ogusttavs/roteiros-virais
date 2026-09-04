/**
 * Fluxo critico da etapa 3 (plano de execucao, criterio de aceite): admin do
 * seed entra, cria um cliente, o cliente entra pelo link magico e cai em
 * /comecar.
 *
 * O plano diz "link magico lido do log". O Playwright roda como processo
 * separado do dev server, sem acesso facil ao stdout dele durante o teste;
 * em vez de depender do log (fragil em CI), lemos o token direto da tabela
 * verification, que e o mesmo dado que aparece no link logado (confirmado
 * manualmente contra o log de desenvolvimento durante a etapa 3).
 */
import { expect, test } from "@playwright/test";
import { desc } from "drizzle-orm";

import { db } from "../../src/db";
import { verification } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const EMAIL_NOVO_CLIENTE = "cliente-e2e@exemplo.teste";

// Seed uma vez so, no globalSetup (etapa 11, ajuste 3 da revisao da etapa 10); o pool do
// Postgres fecha uma vez so, no globalTeardown (playwright.config.ts): mais de um arquivo de
// e2e roda no mesmo worker e compartilha o pool. EMAIL_NOVO_CLIENTE ja e um identificador
// proprio deste arquivo, unico o bastante.

test("admin entra, cria cliente, cliente entra por link magico e cai em /comecar", async ({
  page,
  browser,
}) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/clientes/);

  await page.getByRole("button", { name: "convidar cliente" }).click();
  await page.getByLabel("nome", { exact: true }).fill("[exemplo] Cliente e2e");
  await page.getByLabel("e-mail", { exact: true }).fill(EMAIL_NOVO_CLIENTE);
  await page.getByRole("button", { name: "convidar por e-mail" }).click();

  await expect(page.getByRole("status")).toContainText(EMAIL_NOVO_CLIENTE);

  const [linha] = await db()
    .select({ token: verification.identifier })
    .from(verification)
    .orderBy(desc(verification.createdAt))
    .limit(1);
  expect(linha?.token).toBeTruthy();

  const contextoCliente = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  await paginaCliente.goto(
    `/api/auth/magic-link/verify?token=${linha.token}&callbackURL=%2Fcomecar`,
  );

  await expect(paginaCliente).toHaveURL(/\/comecar/);
  await expect(paginaCliente.getByText("Vamos montar o seu briefing")).toBeVisible();

  await contextoCliente.close();
});
