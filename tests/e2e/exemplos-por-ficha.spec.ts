/**
 * "Para que o vídeo parece feito" (E49 PR 2): no Criar, escolher uma ficha mostra "Exemplos que fazem isso" (e o estado "ainda não temos exemplos" quando o setor não tem);
 * em Referências, a pílula "Parece feito para", o selo no cartão, a contagem e o estado vazio com "Ver todos".
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contas, membrosMarca, nichos, preferenciasUsuario, temasDia, user, videos, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const ID = "e2e-exemplos-ficha";
const EMAIL = `${ID}@exemplo.teste`;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("exemplos por ficha", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
    if (jaExiste) return;
    const [nicho] = await db().insert(nichos).values({ slug: ID, nome: "[teste] Exemplos" }).returning();
    await db().insert(user).values({ id: ID, name: "[teste] Exemplos", email: EMAIL });
    await db().insert(account).values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] Exemplos", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "lavagem de estofados", preco: "sofá por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
    const temas: TemaDoDia[] = [{ titulo: "tema de teste 1", descricao: "d1", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" }];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
    // Um vídeo do setor que parece feito para "Que guardem"; nenhum para "Que comentem".
    const [conta] = await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-exemplos-ficha", nichoId: nicho.id }).returning();
    await db().insert(videos).values({
      plataforma: "tiktok",
      idExterno: "exemplos-ficha-1",
      url: "https://exemplo.invalido/exemplos-ficha-1",
      titulo: "o passo a passo que todo mundo salva",
      contaId: conta.id,
      nichoId: nicho.id,
      views: 120_000,
      publicadoEm: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      foraDaCurva: "9",
      idioma: "pt",
      analise: { assunto: "limpar estofado", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" } as never,
      formatoCatalogo: "passo_a_passo",
      fichaCatalogo: "guardem",
      serveDeModelo: true,
      tipoConteudo: "original",
    });
  });

  test("Criar: a ficha escolhida fica sozinha com os exemplos; sem exemplos, o estado diz; as cinco voltam", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    const grupo = page.locator("[data-fichas]");
    await expect(grupo.getByRole("radio")).toHaveCount(5);
    // A recomendada já marcada não fecha a lista nem pede exemplos.
    await expect(page.locator("[data-exemplos]")).toHaveCount(0);

    await grupo.getByRole("radio", { name: /Que guardem para depois/ }).click();
    await expect(grupo.getByRole("radio")).toHaveCount(1);
    const exemplos = page.locator('[data-exemplos="com"]');
    await expect(exemplos).toBeVisible();
    await expect(exemplos).toContainText("Exemplos que fazem isso");
    await expect(exemplos.locator("[data-exemplo]")).toHaveCount(1);
    await expect(exemplos).toContainText("o passo a passo que todo mundo salva");
    await expect(exemplos.getByRole("link", { name: "Ver mais em Referências" })).toHaveAttribute("href", "/referencias?feitoPara=guardem&periodo=90");

    await page.getByRole("button", { name: "Ver as cinco de novo" }).click();
    await expect(grupo.getByRole("radio")).toHaveCount(5);
    await grupo.getByRole("radio", { name: /Que comentem/ }).click();
    const vazio = page.locator('[data-exemplos="sem"]');
    await expect(vazio).toBeVisible();
    await expect(vazio).toContainText("Ainda não temos exemplos deste tipo no seu setor");
    // Sem exemplos, o roteiro sai do mesmo jeito.
    await expect(page.getByRole("button", { name: "escrever o roteiro" })).toBeEnabled();
  });

  test("Referências: a pílula, o selo no cartão, a contagem e o estado vazio com 'Ver todos'", async ({ page }) => {
    await entrar(page);
    await page.goto("/referencias?seg=todos&feitoPara=guardem");
    const cartao = page.locator("article").filter({ hasText: "o passo a passo que todo mundo salva" });
    await expect(cartao).toBeVisible();
    await expect(cartao.locator("[data-selo-feito-para]")).toHaveText("Que guardem");
    await expect(page.getByText(/parece feito para que guardem/)).toBeVisible();

    await page.goto("/referencias?seg=todos&feitoPara=comentem");
    await expect(page.getByRole("heading", { name: "Ainda não temos exemplos deste tipo no seu setor" })).toBeVisible();
    await expect(page.getByText(/Nenhum vídeo dos últimos 90 dias parece feito para que comentem/)).toBeVisible();
    await page.getByRole("button", { name: "Ver todos" }).click();
    await expect(page).not.toHaveURL(/feitoPara/);
    await expect(page.locator("article").filter({ hasText: "o passo a passo que todo mundo salva" })).toBeVisible();
  });

  test("Referências: a pílula escolhe a ficha e navega", async ({ page }) => {
    await entrar(page);
    await page.goto("/referencias?seg=todos");
    await page.locator("[data-pilula-feito-para]").getByRole("button").first().click();
    await page.getByRole("menuitemradio", { name: /Que guardem \(1\)/ }).click();
    await expect(page).toHaveURL(/feitoPara=guardem/);
    await expect(page.locator("article")).toHaveCount(1);
  });
});
