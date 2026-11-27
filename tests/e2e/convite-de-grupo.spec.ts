/**
 * Convite de grupo, de ponta a ponta pelas telas: abrir o link, criar o acesso e a primeira empresa, cair em /comecar e ir a "Suas empresas" pelo atalho e ver "Criar outra empresa". Link
 * usado ou inventado mostra a mesma frase, sem formulário. O código entra no banco com o mesmo hash que o servidor confere (a geração do código é provada em
 * `tests/integracao/convite-de-grupo.test.ts`).
 */
import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { db } from "../../src/db";
import { clientes, convitesDeGrupo, marcasDoGrupo, nichos, user } from "../../src/db/schema";

const PREFIXO = `convite-e2e-${Date.now()}`;
const hash = (codigo: string) => createHash("sha256").update(codigo).digest("hex");

test.afterAll(async () => {
  const contas = await db().select({ id: user.id }).from(user).where(like(user.email, `${PREFIXO}%`));
  for (const { id } of contas) {
    const marcas = await db().select({ clienteId: marcasDoGrupo.clienteId }).from(marcasDoGrupo).where(eq(marcasDoGrupo.usuarioId, id));
    await db().delete(user).where(eq(user.id, id));
    for (const { clienteId } of marcas) await db().delete(clientes).where(eq(clientes.id, clienteId)).catch(() => undefined);
  }
  await db().delete(convitesDeGrupo).where(like(convitesDeGrupo.rotulo, `${PREFIXO}%`));
});

async function criarConvite(): Promise<string> {
  const [ramo] = await db().select({ id: nichos.id }).from(nichos).limit(1);
  if (!ramo) throw new Error("o seed do e2e nao tem nenhum ramo");
  const codigo = randomBytes(32).toString("base64url");
  await db()
    .insert(convitesDeGrupo)
    .values({ codigoHash: hash(codigo), rotulo: `${PREFIXO}-grupo`, nichoId: ramo.id, marcasMax: 5, cortesia: true, expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  return codigo;
}

test("abrir o link, criar o acesso, cair em /comecar e ver Criar outra empresa em Suas empresas", async ({ page, browser }) => {
  const codigo = await criarConvite();
  const email = `${PREFIXO}@exemplo.teste`;

  await page.goto(`/convite/${codigo}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Crie o seu acesso" })).toBeVisible();

  await page.getByLabel("Seu nome").fill("Leandro Teste");
  await page.getByLabel("Nome da empresa").fill("Clinica Centro");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaBoa12345");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Criar o meu acesso" }).click();

  await expect(page).toHaveURL(/\/comecar/);

  // A Conta fica atrás do briefing, e a empresa nova ainda não tem briefing: o dono vai pelo atalho do /comecar, que leva a /empresas (fora do portão do briefing).
  await page.getByRole("link", { name: "Suas empresas e a equipe" }).click();
  await expect(page).toHaveURL(/\/empresas/);
  await expect(page.getByRole("heading", { name: "Suas empresas", exact: true })).toBeVisible();
  await expect(page.getByText("1 de 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar outra empresa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dar acesso" })).toBeVisible();

  // O link já foi usado: outra pessoa abre e vê só a frase, sem formulário.
  const contexto = await browser.newContext();
  const outra = await contexto.newPage();
  await outra.goto(`/convite/${codigo}`);
  await expect(outra.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
  await expect(outra.getByText("Peça um novo a quem te mandou.")).toBeVisible();
  await expect(outra.getByLabel("Nome da empresa")).toHaveCount(0);
  await contexto.close();
});

test("link inventado mostra a mesma frase, sem formulário", async ({ page }) => {
  await page.goto(`/convite/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
  await expect(page.getByText("Peça um novo a quem te mandou.")).toBeVisible();
  await expect(page.getByLabel("Nome da empresa")).toHaveCount(0);
});

test("a porta do convite para o WhatsApp: /convite?c= é estática, tem a prévia e leva ao convite; sem código, avisa", async ({ page, request }) => {
  const resposta = await request.get("/convite?c=codigo-que-nao-existe-123456", { maxRedirects: 0 });
  expect(resposta.status()).toBe(200);
  const html = await resposta.text();
  expect(html).toContain('<meta property="og:image" content="https://klaki.app/marca/previa-convite.jpg">');
  expect(html).toContain('<meta property="og:url" content="https://klaki.app/convite">');
  expect(html.indexOf('property="og:image"')).toBeLessThan(2000);
  const codigo = randomBytes(32).toString("base64url");
  await page.goto(`/convite?c=${codigo}`);
  await expect(page).toHaveURL(new RegExp(`/convite/${codigo}$`));
  await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
  await page.goto("/convite?c=<script>");
  await expect(page.getByRole("heading", { name: "Este link está incompleto" })).toBeVisible();
});

test("a prévia do link no WhatsApp: título, descrição e imagem do convite, com endereço completo, e a imagem abre sem login", async ({ page, request }) => {
  await page.goto(`/convite/${randomBytes(32).toString("base64url")}`);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /^Um convite para você usar o /);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /Crie o seu acesso/);
  const imagem = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(imagem).toMatch(/^https?:\/\/.+\/marca\/previa-convite\.jpg$/);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/convite\//);
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const resposta = await request.get("/marca/previa-convite.jpg", { maxRedirects: 0 });
  expect(resposta.status()).toBe(200);
  expect(resposta.headers()["content-type"]).toContain("image/jpeg");
  expect((await resposta.body()).length).toBeLessThan(100 * 1024);
});
