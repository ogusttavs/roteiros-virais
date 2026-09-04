/**
 * Preferencia de tema (ajuste da revisao da etapa D, parte 2, PROXIMO.md da
 * etapa 7): escolher um tema em /conta, salvar, recarregar a pagina de
 * verdade (nao so navegacao do lado do cliente) e conferir que o
 * `data-tema` do `<html>` bate com o que o servidor le do banco
 * (`src/app/layout.tsx`). "Do sistema" e a ausencia do atributo.
 *
 * O briefing do cliente e inserido direto no banco (nunca chamando codigo de
 * `src/ia` no processo do Playwright, licao da etapa 5, parte 2): so o
 * suficiente para `completo = true` destravar o grupo `(completo)`, onde
 * /conta mora.
 *
 * Cliente proprio ("e2e-tema-preferencia"), nao o "seed-cliente-dentistas"
 * do seed: etapa 11, ajuste 3 da revisao da etapa 10. Sem `resetarSchema`
 * por arquivo (o seed roda uma vez so, no globalSetup), outro arquivo pode
 * ja ter mexido no briefing do cliente do seed antes deste rodar (por
 * exemplo `briefing.spec.ts`, que preenche o briefing dele pela tela); um
 * cliente com id proprio evita a corrida.
 */
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, nichos, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL_CLIENTE = "e2e-tema-preferencia@exemplo.teste";

test.beforeAll(async () => {
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

  await db().insert(user).values({
    id: "e2e-tema-preferencia",
    name: "[teste] Preferencia de tema",
    email: EMAIL_CLIENTE,
  });
  await db()
    .insert(account)
    .values({
      id: "e2e-tema-preferencia-credential",
      issuer: "local:credential",
      accountId: "e2e-tema-preferencia",
      providerId: "credential",
      userId: "e2e-tema-preferencia",
      password: await hashPassword(SENHA),
    });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: "e2e-tema-preferencia", nome: "[teste] Preferencia de tema", nichoId: nicho.id })
    .returning();
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
});

// O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

test("escolhe escuro, salva, recarrega com data-tema escuro; volta para do sistema, sem atributo", async ({
  page,
}) => {
  await page.goto("/entrar");
  await page.getByLabel("e-mail", { exact: true }).fill(EMAIL_CLIENTE);
  await page.getByLabel("senha", { exact: true }).fill(SENHA);
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
