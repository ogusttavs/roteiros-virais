/**
 * Barra lateral do painel: recolhe para so os icones, volta a abrir, e o
 * estado sobrevive a recarregar a pagina (acabamento visual 2, achado do
 * Gustavo no iPad: a barra lateral some ao rolar e nao recolhia).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, nichos, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-barra-lateral@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("barra lateral do painel", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id: "e2e-barra-lateral", name: "[teste] Barra Lateral", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-barra-lateral-credential",
        issuer: "local:credential",
        accountId: "e2e-barra-lateral",
        providerId: "credential",
        userId: "e2e-barra-lateral",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-barra-lateral",
        nome: "[teste] Barra Lateral",
        nichoId: nicho.id,
        aceitouTermosEm: new Date(),
      })
      .returning();

    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "kit tira-mancha para estofados",
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

  test("recolhe para so os icones, volta a abrir, e o estado sobrevive a recarregar", async ({ page }) => {
    await entrar(page, EMAIL);
    await expect(page).toHaveURL(/\/hoje/);

    const barraLateral = page.locator("aside");
    const rotuloHoje = barraLateral.getByText("Hoje", { exact: true });
    const larguraAberta = (await barraLateral.boundingBox())?.width ?? 0;
    expect(larguraAberta).toBeGreaterThan(150);
    await expect(rotuloHoje).toBeVisible();

    await page.getByRole("button", { name: "recolher o menu" }).click();
    await expect(page.getByRole("button", { name: "abrir o menu" })).toBeVisible();
    // o link continua no DOM (so o icone, com `title="Hoje"` como dica); so o rotulo de texto some.
    await expect(rotuloHoje).toBeHidden();
    // `.colunaDesktop` tem `transition: width`; espera a largura assentar em vez de medir no meio da animacao.
    await expect
      .poll(async () => (await barraLateral.boundingBox())?.width ?? 0)
      .toBeLessThan(100);

    // o estado (localStorage) e lido antes da primeira pintura (src/app/layout.tsx).
    await page.reload();
    await expect(page.getByRole("button", { name: "abrir o menu" })).toBeVisible();
    await expect
      .poll(async () => (await barraLateral.boundingBox())?.width ?? 0)
      .toBeLessThan(100);

    await page.getByRole("button", { name: "abrir o menu" }).click();
    await expect(page.getByRole("button", { name: "recolher o menu" })).toBeVisible();
    await expect(rotuloHoje).toBeVisible();
    await expect
      .poll(async () => (await barraLateral.boundingBox())?.width ?? 0)
      .toBeGreaterThan(150);
  });
});
