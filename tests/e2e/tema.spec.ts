/**
 * Preferencia de tema (ajuste da revisao da etapa D, parte 2, PROXIMO.md da
 * etapa 7): escolher um tema em /conta, salvar, recarregar a pagina de
 * verdade (nao so navegacao do lado do cliente) e conferir que o
 * `data-tema` do `<html>` bate com o que o servidor le do banco
 * (`src/app/layout.tsx`). "Do sistema" e a ausencia do atributo.
 *
 * O briefing do cliente de seed e inserido direto no banco (nunca chamando
 * codigo de `src/ia` no processo do Playwright, licao da etapa 5, parte 2):
 * so o suficiente para `completo = true` destravar o grupo `(completo)`,
 * onde /conta mora.
 */
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { resetarSchema } from "../../scripts/resetar-schema";
import { semear } from "../../scripts/semear";
import { db } from "../../src/db";
import { briefings, clientes } from "../../src/db/schema";

const EMAIL_CLIENTE = "seed-cliente-dentistas@exemplo.teste";
const SENHA_CLIENTE = "ExemploSenha123";

test.beforeAll(async () => {
  await resetarSchema(db());
  await semear(db());

  const [cliente] = await db()
    .select({ id: clientes.id })
    .from(clientes)
    .where(eq(clientes.usuarioId, "seed-cliente-dentistas"));
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
});

// O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

test("escolhe escuro, salva, recarrega com data-tema escuro; volta para do sistema, sem atributo", async ({
  page,
}) => {
  await page.goto("/entrar");
  await page.getByLabel("e-mail", { exact: true }).fill(EMAIL_CLIENTE);
  await page.getByLabel("senha", { exact: true }).fill(SENHA_CLIENTE);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);

  await page.goto("/conta");
  await page.getByRole("button", { name: "escuro", exact: true }).click();
  await page.getByRole("button", { name: "salvar", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-tema", "escuro");

  await page.getByRole("button", { name: "do sistema", exact: true }).click();
  await page.getByRole("button", { name: "salvar", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-tema");
});
