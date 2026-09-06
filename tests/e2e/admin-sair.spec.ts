/**
 * Rodada de acabamento de 06/09, item 6: o admin nao tinha como sair da
 * propria conta ("sair" so existia em `/conta`, do cliente). Achado do
 * Gustavo em producao, tentando trocar da conta de admin para a da
 * Dr.Wash.
 */
import { expect, test } from "@playwright/test";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";

test("admin entra, sai, cai em /entrar, e /admin/clientes volta a redirecionar", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/clientes/);

  await page.getByRole("button", { name: "sair", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar/);

  await page.goto("/admin/clientes");
  await expect(page).toHaveURL(/\/entrar/);
});
