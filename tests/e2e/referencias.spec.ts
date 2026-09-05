/**
 * Favoritar um vídeo em `/referencias` e vê-lo na aba "favoritos" (etapa
 * 12, decisão 1 do `PROXIMO.md`, "O que a etapa 12 entrega").
 *
 * Mesma lição de `roteiro.spec.ts`: grava briefing e vídeo direto no banco,
 * sem `resetarSchema` (já rodou no globalSetup); cliente próprio
 * ("e2e-referencias"), nicho "limpeza-e-organizacao-da-casa" (já semeado).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, nichos, user, videos } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-referencias@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("favoritar em /referencias", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id: "e2e-referencias", name: "[teste] Referencias", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-referencias-credential",
        issuer: "local:credential",
        accountId: "e2e-referencias",
        providerId: "credential",
        userId: "e2e-referencias",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-referencias",
        nome: "[teste] Referencias",
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

    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-referencias-mancha",
        url: "https://exemplo.invalido/e2e-referencias-mancha",
        nichoId: nicho.id,
        titulo: "o produto que tira qualquer mancha do estofado",
        foraDaCurva: "6.2",
        publicadoEm: new Date(),
        analise: {
          assunto: "mancha em estofado",
          gancho: "esse produto tira qualquer mancha do estofado",
          estrutura: "mostra o produto agindo na mancha antes de explicar",
          fechamento: "resumo do que foi mostrado",
          chamadaFinal: "comenta se voce ja passou por isso",
          formato: "fala_para_camera",
          porQueFuncionou: "todo mundo ja teve essa mancha",
        } as never,
      });
  });

  test("favoritar um video e ve-lo com o filtro de favoritos", async ({ page }) => {
    await entrar(page, EMAIL);
    await expect(page).toHaveURL(/\/hoje/);

    await page.goto("/referencias");

    const cartao = page.locator("article", { hasText: "esse produto tira qualquer mancha do estofado" });
    await expect(cartao).toBeVisible();

    await cartao.getByRole("button", { name: "salvar nos favoritos" }).click();
    await expect(page.getByText("salvo; entra como referência no seu briefing")).toBeVisible();
    // espera a Server Action responder de verdade (botao sai de "salvando" e
    // fica desabilitado ate la, achado da revisao da parte 1): sem isso, o
    // reload logo abaixo podia abortar o pedido antes de gravar no banco.
    await expect(cartao.getByRole("button", { name: "remover dos favoritos" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "favoritos", exact: true }).click();
    await expect(cartao).toBeVisible();

    // recarrega: o favorito precisa ter gravado no banco, nao so no estado do navegador.
    await page.reload();
    const cartaoDepoisDeRecarregar = page.locator("article", { hasText: "esse produto tira qualquer mancha do estofado" });
    await expect(cartaoDepoisDeRecarregar).toBeVisible();
    await expect(cartaoDepoisDeRecarregar.getByRole("button", { name: "remover dos favoritos" })).toBeVisible();
  });
});
