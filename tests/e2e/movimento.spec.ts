/**
 * A fluidez do painel (E51 PR 2, passo 16 do Opus): a folha acompanha o dedo e fecha ao arrastar, "reduzir movimento" troca o deslizar pelo esmaecer, a
 * tela que chega anima na entrada (e só `transform` e `opacity`), a cápsula do celular fica encolhida ao soltar, e o aperto dos botões usa os tokens.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const ID = "e2e-movimento";
const EMAIL = "e2e-movimento@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
  await page.waitForLoadState("networkidle");
}

test.describe("movimento (E51 PR 2)", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
    if (jaExiste) return;
    const [nicho] = await db().insert(nichos).values({ slug: ID, nome: "[teste] Movimento" }).returning();
    await db().insert(user).values({ id: ID, name: "[teste] Movimento", email: EMAIL });
    await db()
      .insert(account)
      .values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] Movimento", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofá de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
  });

  test("a folha arrastada para baixo fecha acompanhando o dedo; solta pouco, volta e continua aberta", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.getByRole("button", { name: /Mais:/ }).click();
    const folha = page.getByRole("dialog", { name: "Mais" });
    await expect(folha).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));

    const topo = folha.getByRole("heading", { name: "Mais" });
    const caixa = (await topo.boundingBox())!;
    const x = caixa.x + caixa.width / 2;
    const y = caixa.y + caixa.height / 2;

    // Um pedaço pequeno do caminho (menos de 30% da folha e devagar): volta e continua aberta, e o deslocamento acompanha o dedo enquanto ele está embaixo.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 20, { steps: 4 });
    const deslocada = await folha.evaluate((el) => getComputedStyle(el).transform);
    expect(deslocada).not.toBe("none");
    await page.mouse.up();
    await expect(folha).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));

    // Passa de 30% da altura: fecha.
    const caixa2 = (await topo.boundingBox())!;
    await page.mouse.move(caixa2.x + caixa2.width / 2, caixa2.y + caixa2.height / 2);
    await page.mouse.down();
    await page.mouse.move(caixa2.x + caixa2.width / 2, caixa2.y + 400, { steps: 8 });
    await page.mouse.up();
    await expect(folha).toHaveCount(0);
  });

  test("a folha centrada do desktop continua centrada depois da animação (a entrada anima `transform`, o centro é a propriedade `translate`)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto("/planejamento");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Contar a minha agenda" }).first().click();
    const folha = page.getByRole("dialog").first();
    await expect(folha).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));

    const caixa = (await folha.boundingBox())!;
    const centroX = caixa.x + caixa.width / 2;
    const centroY = caixa.y + caixa.height / 2;
    expect(Math.abs(centroX - 640)).toBeLessThan(2);
    expect(Math.abs(centroY - 450)).toBeLessThan(2);
    expect(await folha.evaluate((el) => getComputedStyle(el).translate)).not.toBe("none");

    // E o aperto de um botão não desfaz a posição de nada: depois de apertar e soltar, a folha segue no mesmo lugar.
    await folha.getByRole("button", { name: "Fechar" }).hover();
    const depois = (await folha.boundingBox())!;
    expect(Math.abs(depois.x - caixa.x)).toBeLessThan(1);
    expect(Math.abs(depois.y - caixa.y)).toBeLessThan(1);
  });

  test("a folha sai pela animação de saída e o foco volta ao botão que a abriu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    const botaoMais = page.getByRole("button", { name: /Mais:/ });
    await botaoMais.click();
    const folha = page.getByRole("dialog", { name: "Mais" });
    await expect(folha).toBeVisible();

    await page.keyboard.press("Escape");
    // Enquanto sai, ela ainda existe com `data-saindo` (260 ms); depois desmonta.
    await expect(folha).toHaveCount(0);
    await expect(botaoMais).toBeFocused();
  });

  test("com 'reduzir movimento' a folha só esmaece; sem ele, sobe", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: /Mais:/ }).click();
    const folha = page.getByRole("dialog", { name: "Mais" });
    await expect(folha).toBeVisible();
    expect(await folha.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/folha-sobe/);
    await page.keyboard.press("Escape");
    await expect(folha).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: /Mais:/ }).click();
    await expect(folha).toBeVisible();
    expect(await folha.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/veu-aparece/);
    expect(await folha.evaluate((el) => getComputedStyle(el).animationName)).not.toMatch(/folha-sobe/);
  });

  test("a tela que chega anima na entrada: trocar de aba esmaece, entrar numa tela mais funda desliza; reduzir movimento só esmaece", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("link", { name: "Criar" }).click();
    await expect(page).toHaveURL(/\/criar$/);
    expect(await page.locator("[data-transicao]").first().getAttribute("data-transicao")).toBe("troca");

    // Entrar numa tela dentro da aba (uma rota mais funda): desliza; "Voltar" desliza para o outro lado; reduzir movimento só esmaece.
    await page.getByRole("button", { name: /Os temas de hoje/ }).click();
    await expect(page).toHaveURL(/\/criar\/temas/);
    await expect(page.locator("[data-transicao]").first()).toHaveAttribute("data-transicao", "entra");
    expect(await page.locator("[data-transicao]").first().evaluate((el) => getComputedStyle(el).animationName)).toMatch(/tela-entra/);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goBack();
    await expect(page).toHaveURL(/\/criar$/);
    await expect(page.locator("[data-transicao]").first()).toHaveAttribute("data-transicao", "volta");
    expect(await page.locator("[data-transicao]").first().evaluate((el) => getComputedStyle(el).animationName)).toMatch(/tela-esmaece/);
  });

  test("a cápsula encolhe ao rolar para baixo e FICA encolhida ao soltar; tocar nela a abre", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/referencias");
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "body { padding-bottom: 1600px !important; }" });
    const capsula = page.getByRole("navigation", { name: "Navegação principal" });
    const larguraCheia = (await capsula.boundingBox())!.width;

    for (let y = 0; y <= 320; y += 40) {
      await page.evaluate((alvo) => window.scrollTo(0, alvo), y);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(600);
    const larguraEncolhida = (await capsula.boundingBox())!.width;
    expect(larguraEncolhida).toBeLessThan(larguraCheia - 40);

    // Parada, sem tocar em nada: continua encolhida.
    await page.waitForTimeout(800);
    expect((await capsula.boundingBox())!.width).toBeLessThan(larguraCheia - 40);

    // Um toque nela abre (o toque num ícone vai direto ao destino e a cápsula abre junto).
    await page.getByRole("link", { name: "Hoje" }).click();
    await expect(page).toHaveURL(/\/hoje/);
    await page.waitForTimeout(700);
    expect((await capsula.boundingBox())!.width).toBeGreaterThan(larguraEncolhida + 40);
  });

  test("o botão aperta com o token de escala e volta (:active), e a seleção da cápsula desliza por transform", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    const selecao = page.locator("[data-selecao]");
    const antes = await selecao.evaluate((el) => (el as HTMLElement).style.transform);
    await page.getByRole("link", { name: "Criar" }).click();
    await expect(page).toHaveURL(/\/criar$/);
    const depois = await selecao.evaluate((el) => (el as HTMLElement).style.transform);
    expect(depois).not.toBe(antes);
    expect(await selecao.evaluate((el) => getComputedStyle(el).transitionProperty)).toMatch(/transform/);
  });
});
