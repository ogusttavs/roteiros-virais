/**
 * A página de entrada e o "Quero testar" (E57a), de ponta a ponta: quem chega sem conta vê o que o produto faz, o preço do plano trimestral e o formulário; o formulário
 * pede o aceite do contato, grava a pessoa e agradece; o admin vê a pessoa em `/admin/interessados` e mais ninguém vê; quem já está com sessão vai direto para o painel; e a
 * política de privacidade fala da coleta. O e-mail ao admin é simulado no modo e2e (cai no log), e o limite de pedidos por IP fica desligado nele (`MODO_E2E`); os dois são provados
 * em `tests/integracao/interessados.test.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { db } from "../../src/db";
import { interessados } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const EMAIL_CLIENTE_COMUM = "seed-cliente-dentistas@exemplo.teste";
const SENHA_SEED = "ExemploSenha123";

const PREFIXO = "quero-testar-e2e";
const MARCADOR = "[exemplo-e2e-quero-testar] Pessoa que so o admin pode ver";

test.beforeAll(async () => {
  await db().delete(interessados).where(like(interessados.email, `${PREFIXO}%`));
});

test.afterAll(async () => {
  await db().delete(interessados).where(like(interessados.email, `${PREFIXO}%`));
});

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  // Sai de /entrar quando a sessão existe (a primeira visita ao painel pode compilar a rota; nada de contar com a rede ociosa).
  await page.waitForURL((url) => !url.pathname.startsWith("/entrar"), { timeout: 60_000 });
}

test("sem conta: a página mostra o que o produto faz, o preço do trimestral e o formulário", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Todo dia, o roteiro pronto para você gravar.");
  await expect(page.getByRole("heading", { name: "Como funciona" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Um roteiro pronto, com a edição junto" })).toBeVisible();
  await expect(page.locator("[data-preco]")).toHaveText("R$ 397 por mês");
  await expect(page.getByText("R$ 1.191 a cada 3 meses")).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar" }).first()).toHaveAttribute("href", "/entrar");
  await expect(page.getByRole("link", { name: "política de privacidade" }).first()).toHaveAttribute("href", "/privacidade");
  // Nada de promessa que o produto não cumpre, nem de jargão, na página inteira.
  const texto = (await page.locator("body").innerText()).toLowerCase();
  for (const proibido of ["viralize", "garantid", "viral garantido", "engajamento", "funil"]) expect(texto).not.toContain(proibido);
});

test("o formulário pede o aceite, mostra o erro de cada campo e, preenchido, grava e agradece", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Vazio: cada campo diz o que falta, e nada é gravado.
  await page.getByRole("button", { name: "Quero testar", exact: true }).last().click();
  await expect(page.getByText("Escreva o seu nome.")).toBeVisible();
  await expect(page.getByText("Esse e-mail não parece certo. Confira.")).toBeVisible();
  await expect(page.getByText("Escreva o WhatsApp com o DDD, por exemplo 11 91234-5678.")).toBeVisible();
  await expect(page.getByText("Conte em poucas palavras o que o seu negócio faz.")).toBeVisible();
  await expect(page.getByText("Marque a caixa para a gente poder entrar em contato.")).toBeVisible();

  // Tudo certo, menos o aceite: o servidor recusa só por isso.
  await page.getByLabel("Seu nome").fill("Ana Prado");
  await page.getByLabel("Seu e-mail").fill(`${PREFIXO}-ana@exemplo.com.br`);
  await page.getByLabel("Seu WhatsApp").fill("(11) 91234-5678");
  await page.getByLabel("Seu ramo").fill("dentista");
  await page.getByRole("button", { name: "Quero testar", exact: true }).last().click();
  await expect(page.getByText("Marque a caixa para a gente poder entrar em contato.")).toBeVisible();
  await expect(page.getByText("Escreva o seu nome.")).toHaveCount(0);
  expect(await db().select().from(interessados).where(eq(interessados.email, `${PREFIXO}-ana@exemplo.com.br`))).toHaveLength(0);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Quero testar", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Recebemos o seu pedido.");

  const linhas = await db().select().from(interessados).where(eq(interessados.email, `${PREFIXO}-ana@exemplo.com.br`));
  expect(linhas).toHaveLength(1);
  expect(linhas[0]).toMatchObject({ nome: "Ana Prado", whatsapp: "11912345678", ramo: "dentista" });
});

test("o campo escondido não aparece nem recebe o Tab; preenchido por um robô, o pedido não é gravado", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const armadilha = page.locator('input[name="site"]');
  // Fora da tela (e não `display: none`, que robô esperto pula), fora do Tab e escondido de leitor de tela.
  const caixa = await armadilha.boundingBox();
  expect(caixa).not.toBeNull();
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(0);
  await expect(armadilha).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[aria-hidden="true"]').locator('input[name="site"]')).toHaveCount(1);

  await page.getByLabel("Seu nome").fill("Robo Spam");
  await page.getByLabel("Seu e-mail").fill(`${PREFIXO}-robo@exemplo.com.br`);
  await page.getByLabel("Seu WhatsApp").fill("11 91234-5678");
  await page.getByLabel("Seu ramo").fill("spam");
  await armadilha.fill("http://spam.example", { force: true });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Quero testar", exact: true }).last().click();
  // O robô vê o mesmo "recebemos", para não aprender nada; nada foi gravado.
  await expect(page.getByRole("status")).toContainText("Recebemos o seu pedido.");
  expect(await db().select().from(interessados).where(eq(interessados.email, `${PREFIXO}-robo@exemplo.com.br`))).toHaveLength(0);
});

test("a política de privacidade fala da coleta do Quero testar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "política de privacidade" }).first().click();
  await expect(page).toHaveURL(/\/privacidade$/);
  await expect(page.getByRole("heading", { name: "6. Quem pede para testar" })).toBeVisible();
  await expect(page.getByText("o nome, o e-mail, o WhatsApp e o ramo do negócio")).toBeVisible();
  await expect(page.getByText("até 12 meses depois do pedido")).toBeVisible();
  // O "voltar" da política leva de volta à página de entrada.
  await page.getByRole("link", { name: "voltar" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("a lista do admin: o admin vê e apaga a pessoa; sem sessão e com cliente comum, o corpo da resposta nunca traz a pessoa", async ({ page, request }) => {
  await db().insert(interessados).values({
    nome: MARCADOR,
    email: `${PREFIXO}-lista@exemplo.com.br`,
    whatsapp: "11987654321",
    ramo: "estetica automotiva",
    aceitouContatoEm: new Date(),
  });

  // Sem sessão: redireciona e o corpo não traz o dado.
  const semSessao = await request.get("/admin/interessados", { maxRedirects: 0 });
  expect(semSessao.status()).toBe(307);
  expect(await semSessao.text()).not.toContain(MARCADOR);

  // Cliente comum: o mesmo, sem seguir o redirecionamento.
  await entrar(page, EMAIL_CLIENTE_COMUM);
  const cookie = (await page.context().cookies()).find((c) => c.name === "better-auth.session_token");
  expect(cookie).toBeDefined();
  const comoCliente = await request.get("/admin/interessados", { maxRedirects: 0, headers: { Cookie: `${cookie!.name}=${cookie!.value}` } });
  expect(comoCliente.status()).toBe(307);
  expect(await comoCliente.text()).not.toContain(MARCADOR);
  await page.goto("/admin/interessados");
  await expect(page).toHaveURL(/\/(hoje|comecar)/);

  // Admin: vê a pessoa, o WhatsApp por extenso e o link para abrir a conversa.
  await page.context().clearCookies();
  await entrar(page, EMAIL_ADMIN);
  await page.goto("/admin/interessados");
  const linha = page.locator("tr", { hasText: MARCADOR });
  await expect(linha).toBeVisible();
  await expect(linha).toContainText("11 98765-4321");
  await expect(linha.getByRole("link")).toHaveAttribute("href", "https://wa.me/5511987654321");
  await expect(page.getByRole("link", { name: "Interessados" })).toBeVisible();

  // Apagar pede confirmação e depois some da lista e do banco.
  await linha.getByRole("button", { name: /apagar/ }).click();
  await linha.getByRole("button", { name: "não apagar" }).click();
  await expect(linha).toBeVisible();
  await linha.getByRole("button", { name: /apagar/ }).click();
  await linha.getByRole("button", { name: "apagar de vez" }).click();
  await expect(page.locator("tr", { hasText: MARCADOR })).toHaveCount(0);
  expect(await db().select().from(interessados).where(eq(interessados.email, `${PREFIXO}-lista@exemplo.com.br`))).toHaveLength(0);
});

test("quem já está com sessão não vê a página de vendas: vai direto para o painel", async ({ page }) => {
  await entrar(page, EMAIL_CLIENTE_COMUM);
  await page.goto("/");
  await expect(page).toHaveURL(/\/(hoje|comecar|briefing)/);
});

test("no celular (390) a página não passa da largura da tela", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const [largura, janela] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(largura).toBeLessThanOrEqual(janela);
});
