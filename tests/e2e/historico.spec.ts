/**
 * Abrir `/historico` e ver o roteiro gravado (etapa 12, decisão 3 do
 * `PROXIMO.md`, "O que a etapa 12 entrega"): a constância no topo e a
 * lista por semana, com o toque abrindo o roteiro.
 *
 * Mesma lição de `roteiro.spec.ts`: grava tudo direto no banco, sem
 * `resetarSchema` (já rodou no globalSetup); cliente próprio
 * ("e2e-historico"), nicho "limpeza-e-organizacao-da-casa" (já semeado).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, nichos, roteiros, user } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-historico@exemplo.teste";

const CONTEUDO_MINIMO = {
  titulo: "titulo do e2e",
  duracaoS: 40,
  gancho: "gancho do e2e",
  corpo: "corpo do e2e",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
};

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("historico com roteiro gravado", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id: "e2e-historico", name: "[teste] Historico", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-historico-credential",
        issuer: "local:credential",
        accountId: "e2e-historico",
        providerId: "credential",
        userId: "e2e-historico",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-historico",
        nome: "[teste] Historico",
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

    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: hojeISO(),
        tema: "o produto que tira qualquer mancha do e2e",
        origem: "sugerido",
        objetivo: "alcance",
        conteudo: CONTEUDO_MINIMO,
        status: "gravado",
        gravadoEm: new Date(),
      });
  });

  test("mostra a constancia e o roteiro gravado, e o toque abre o roteiro", async ({ page }) => {
    await entrar(page, EMAIL);
    await expect(page).toHaveURL(/\/hoje/);

    await page.goto("/historico");

    await expect(page.getByText("dias seguidos")).toBeVisible();
    await expect(page.getByText("gravados este mês")).toBeVisible();
    await expect(page.getByText("postados este mês")).toBeVisible();

    const item = page.getByRole("link", { name: /o produto que tira qualquer mancha do e2e/ });
    await expect(item).toBeVisible();
    await expect(item.getByText("gravado", { exact: true })).toBeVisible();

    await item.click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
