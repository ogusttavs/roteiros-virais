/**
 * Aceite dos termos no primeiro acesso (etapa 12, decisão 7 do
 * `PROXIMO.md`): cliente com briefing completo mas sem `aceitou_termos_em`
 * ve a folha em vez da rota pedida; aceitar libera a rota, sem precisar
 * entrar de novo.
 *
 * Mesma lição de `roteiro.spec.ts` e `historico.spec.ts`: grava tudo direto
 * no banco, sem `resetarSchema` (já rodou no globalSetup); cliente próprio
 * ("e2e-aceite-termos"), nicho "limpeza-e-organizacao-da-casa" (já semeado).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-aceite-termos@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("aceite dos termos no primeiro acesso", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): se a pessoa de teste já existe, a
    // primeira passada já criou tudo o que ela precisa.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-aceite-termos"));
    if (jaExiste) return;

    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id: "e2e-aceite-termos", name: "[teste] Aceite Termos", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-aceite-termos-credential",
        issuer: "local:credential",
        accountId: "e2e-aceite-termos",
        providerId: "credential",
        userId: "e2e-aceite-termos",
        password: await hashPassword(SENHA),
      });
    // Sem preferenciasUsuario/aceitouTermosEm de proposito: e exatamente o estado que este teste cobre.
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-aceite-termos", nome: "[teste] Aceite Termos", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-aceite-termos", clienteId: cliente.id, papel: "dono" });

    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "produtos de limpeza",
            preco: "kit a partir de 89 reais",
            clienteIdeal: "mora em apartamento",
            medos: [],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: [],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "marca propria de produtos de limpeza",
          referencias: [],
        },
      });
  });

  test("mostra a folha antes de aceitar, e a rota pedida depois", async ({ page }) => {
    await entrar(page, EMAIL);
    await expect(page).toHaveURL(/\/hoje/);

    await expect(page.getByRole("heading", { name: "Antes de entrar" })).toBeVisible();
    await expect(page.getByText("Os roteiros são sugestões; quem grava e publica é você.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).not.toBeVisible();

    await page.getByRole("button", { name: "li e aceito" }).click();

    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Antes de entrar" })).not.toBeVisible();

    // Recarregar confirma que o aceite ficou gravado, nao so no estado da pagina.
    await page.reload();
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
  });

  /** E37b, item 9: versao nova dos termos pede aceite de novo, mesmo de quem ja tinha aceitado uma versao anterior. */
  test("versao nova dos termos mostra a folha de novo, mesmo para quem ja aceitou uma versao antiga", async ({
    page,
  }) => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({
      id: "e2e-aceite-termos-versao-antiga",
      name: "[teste] Aceite Termos Versao Antiga",
      email: "e2e-aceite-termos-versao-antiga@exemplo.teste",
    });
    await db()
      .insert(account)
      .values({
        id: "e2e-aceite-termos-versao-antiga-credential",
        issuer: "local:credential",
        accountId: "e2e-aceite-termos-versao-antiga",
        providerId: "credential",
        userId: "e2e-aceite-termos-versao-antiga",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-aceite-termos-versao-antiga",
        nome: "[teste] Aceite Termos Versao Antiga",
        nichoId: nicho.id,
      })
      .returning();
    await db()
      .insert(membrosMarca)
      .values({ usuarioId: "e2e-aceite-termos-versao-antiga", clienteId: cliente.id, papel: "dono" });
    await db()
      .insert(briefings)
      .values({ clienteId: cliente.id, completo: true });
    // Aceitou uma versao bem antiga dos termos, de proposito: e exatamente o estado que este teste cobre.
    await db()
      .insert(preferenciasUsuario)
      .values({ usuarioId: "e2e-aceite-termos-versao-antiga", aceitouTermosEm: new Date("2026-01-01T00:00:00Z") });

    await entrar(page, "e2e-aceite-termos-versao-antiga@exemplo.teste");
    await expect(page).toHaveURL(/\/hoje/);

    await expect(page.getByRole("heading", { name: "Antes de entrar" })).toBeVisible();
    await page.getByRole("button", { name: "li e aceito" }).click();
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
  });
});
