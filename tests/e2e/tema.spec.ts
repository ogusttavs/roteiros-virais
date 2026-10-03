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
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL_CLIENTE = "e2e-tema-preferencia@exemplo.teste";
const EMAIL_ADMIN_COM_MARCA = "e2e-tema-admin@exemplo.teste";

/** A2, item 9: um admin que também tem marca (o Gustavo), para ver a Conta com a folha "Informações do aparelho". */
async function criarAdminComMarca() {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-tema-admin"));
  if (jaExiste) return;
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
  await db().insert(user).values({ id: "e2e-tema-admin", name: "[teste] Admin com marca", email: EMAIL_ADMIN_COM_MARCA, role: "admin" });
  await db()
    .insert(account)
    .values({
      id: "e2e-tema-admin-credential",
      issuer: "local:credential",
      accountId: "e2e-tema-admin",
      providerId: "credential",
      userId: "e2e-tema-admin",
      password: await hashPassword(SENHA),
    });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-tema-admin", nome: "[teste] Admin com marca", nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId: "e2e-tema-admin", clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-tema-admin", aceitouTermosEm: new Date() });
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
}

test.beforeAll(async () => {
  await criarAdminComMarca();
  // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-tema-preferencia"));
  if (jaExiste) return;

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
    .values({
      usuarioId: "e2e-tema-preferencia",
      nome: "[teste] Preferencia de tema",
      nichoId: nicho.id,
    })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: "e2e-tema-preferencia", clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-tema-preferencia", aceitouTermosEm: new Date() });
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

/** H3, item 4 (A2, item 9: só para admin): a folha "Informações do aparelho", só leitura, sem dado de cliente. */
test("Informações do aparelho: o cliente comum não vê; o admin abre a folha, vê a largura da janela e o navegador, e o botão Copiar funciona", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // O cliente comum não vê nem o botão (e a frase não cita nome de agente).
  await page.goto("/entrar");
  await page.getByLabel("e-mail", { exact: true }).fill(EMAIL_CLIENTE);
  await page.getByLabel("senha", { exact: true }).fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
  await page.goto("/conta");
  await expect(page.getByRole("heading", { name: "Conta" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Informações do aparelho" })).toHaveCount(0);
  await expect(page.getByText("Só para o Fable")).toHaveCount(0);

  // O admin (com marca) vê.
  await page.getByRole("button", { name: /sair/i }).first().click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.getByLabel("e-mail", { exact: true }).fill(EMAIL_ADMIN_COM_MARCA);
  await page.getByLabel("senha", { exact: true }).fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/(hoje|admin)/);
  await page.goto("/conta");
  await page.getByRole("button", { name: "Informações do aparelho" }).click();

  const folha = page.getByRole("dialog", { name: "Informações do aparelho" });
  await expect(folha).toBeVisible();
  await expect(folha.getByText("para a gente entender o que apareceu torto", { exact: false })).toBeVisible();
  await expect(folha.getByText("largura da janela")).toBeVisible();
  await expect(folha.getByText("navegador", { exact: true })).toBeVisible();
  await expect(folha.getByText(/^\d+px$/).first()).toBeVisible();

  await folha.getByRole("button", { name: "Copiar" }).click();
  await expect(folha.getByRole("button", { name: "Copiado" })).toBeVisible();

  const { copiado, userAgent } = await page.evaluate(async () => ({
    copiado: await navigator.clipboard.readText(),
    userAgent: navigator.userAgent,
  }));
  expect(copiado).toContain("largura da janela");
  expect(copiado).toContain(userAgent);
});
