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
import { account, briefings, clientes, nichos, user } from "../../src/db/schema";

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
    // Sem aceitouTermosEm de proposito: e exatamente o estado que este teste cobre.
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-aceite-termos", nome: "[teste] Aceite Termos", nichoId: nicho.id })
      .returning();

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
});
