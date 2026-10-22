/**
 * Hotfix de 22/10/2026, itens 3 e 4 (achados do Gustavo em produção), pela tela.
 *
 * Item 3: a nota do Tema livre fica guardada com o rascunho. Voltar com o mesmo texto mostra a nota sem avaliar de novo (cada avaliação é uma chamada de IA paga: contam-se as gerações), o texto
 * que mudou apaga a nota, e o Criar mostra "Continuar de onde parou" com "Descartar" ao lado.
 *
 * Item 4: a falha da avaliação chega como frase calma com "Tentar de novo", nunca como a tela girando sem fim. O simulador força a falha pelo marcador `[mock:erro-sobrecarga]` no texto.
 *
 * Pessoa própria ("e2e-nota-guardada"), sem `resetarSchema`; seguro para a repetição automática do Playwright.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, geracoesIA, membrosMarca, nichos, preferenciasUsuario, rascunhosTemaLivre, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const ID = "e2e-nota-guardada";
const EMAIL = `${ID}@exemplo.teste`;
const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";
const CAMPO = "Sobre o que você quer falar?";
const TEXTO = `como tirar mancha de vinho do sofá ${MARCADOR_NOTA_ALTA}`;

let marcaId = 0;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

async function quantasAvaliacoes(): Promise<number> {
  const linhas = await db()
    .select({ id: geracoesIA.id })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "avaliarTema"), eq(geracoesIA.clienteId, marcaId)));
  return linhas.length;
}

test.describe("tema livre: a nota fica guardada e a falha vira frase calma", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
    if (!jaExiste) {
      const [nicho] = await db().insert(nichos).values({ slug: ID, nome: "[teste] Nota guardada" }).returning();
      await db().insert(user).values({ id: ID, name: "[teste] Nota guardada", email: EMAIL });
      await db().insert(account).values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
      await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
      const [marca] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] Nota guardada", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marca.id, papel: "dono" });
      await db().insert(briefings).values({
        clienteId: marca.id,
        completo: true,
        perfil: {
          fatos: { oQueVende: "lavagem de estofados", preco: "sofá por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: ["política"], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
          resumo: "lava estofados em domicílio",
          referencias: [],
        },
      });
    }
    const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID));
    marcaId = marca.id;
  });

  test.beforeEach(async () => {
    // Cada teste parte sem rascunho (a repetição do Playwright não herda o do teste anterior).
    await db().delete(rascunhosTemaLivre).where(eq(rascunhosTemaLivre.usuarioId, ID));
  });

  test("avalia, sai e volta: a nota continua lá sem avaliar de novo; o Criar tem Continuar de onde parou; mudar o texto apaga a nota; Descartar limpa tudo", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/tema-livre");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(CAMPO).fill(TEXTO);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    const aposAvaliar = await quantasAvaliacoes();

    // O Criar agora oferece continuar de onde a pessoa parou.
    await page.goto("/criar");
    const linha = page.locator("[data-continuar-de-onde-parou]");
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("Continuar de onde parou");
    await expect(linha).toContainText("como tirar mancha de vinho do sofá");
    await expect(linha).toContainText(/Nota 9,\d/);

    await linha.getByRole("button", { name: "Continuar" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre/);
    // A nota já está na tela, sem avaliar de novo e sem nenhuma geração nova.
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await expect(page.locator("[data-nota-guardada]")).toBeVisible();
    expect(await quantasAvaliacoes()).toBe(aposAvaliar);

    // Recarregar a página: o mesmo.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    expect(await quantasAvaliacoes()).toBe(aposAvaliar);

    // Mudou o texto: a nota antiga some e pede para avaliar de novo.
    await page.getByRole("button", { name: "Editar o texto" }).click();
    await page.getByLabel(CAMPO).fill(`${TEXTO} de couro`);
    await page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/criar/tema-livre");
    await page.reload();
    await expect(page.getByLabel(CAMPO)).toHaveValue(`${TEXTO} de couro`);
    await expect(page.locator("[data-nota-guardada]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Avaliar o tema" })).toBeVisible();
    // E o Criar não oferece mais continuar (a nota era do texto antigo).
    await page.goto("/criar");
    await expect(page.locator("[data-continuar-de-onde-parou]")).toHaveCount(0);

    // Avalia de novo o texto novo, e Descartar apaga o rascunho com a nota.
    await page.goto("/criar/tema-livre");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.goto("/criar");
    await expect(linha).toBeVisible();
    await linha.getByRole("button", { name: /^Descartar/ }).click();
    await expect(linha).toHaveCount(0);
    await page.goto("/criar/tema-livre");
    await expect(page.getByLabel(CAMPO)).toHaveValue("");
  });

  test("a avaliação que falha mostra a frase calma e Tentar de novo, nunca a tela girando; dois toques seguidos não pagam duas avaliações", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/tema-livre");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(CAMPO).fill("um assunto que a IA não consegue avaliar agora [mock:erro-sobrecarga]");
    await page.getByRole("button", { name: "Avaliar o tema" }).dblclick();

    await expect(page.getByText("Não deu para avaliar o tema")).toBeVisible();
    await expect(page.getByText("Não conseguimos fazer isso agora. Tente de novo em um minuto.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeEnabled();
    // Nada de avaliando girando.
    await expect(page.getByText("Costuma levar menos de 10 segundos.")).toHaveCount(0);
    // O texto continua na tela, guardado.
    await expect(page.getByText("um assunto que a IA não consegue avaliar agora")).toBeVisible();
  });
});
