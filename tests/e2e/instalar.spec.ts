/**
 * E48, PR 1: o convite de instalar o aplicativo no celular, de ponta a ponta.
 *
 * - Android: o convite não aparece no login; aparece depois que o primeiro roteiro está na tela, com o botão "Adicionar ao celular" (o navegador
 *   manda o `beforeinstallprompt`, aqui simulado por um evento sintético com `prompt` e `userChoice`), e o botão chama o pedido do navegador.
 * - iPhone: os dois passos escritos, sem botão de instalar; "Agora não" guarda a data no servidor (sete dias) e a folha não volta na recarga.
 * - Instalado (modo aplicativo): sem convite, e a primeira abertura grava `instalado_em`, que o admin vê na lista de marcas.
 * - Computador: nada.
 * - Conta: o cartão ganha o botão no Android e não no iPhone.
 *
 * O `userAgent` vem do contexto de cada bloco; o modo aplicativo é emulado com `navigator.standalone` (o jeito do iPhone).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const TITULO_CONVITE = "Coloque o aplicativo na tela de início";

function email(usuarioId: string): string {
  return `${usuarioId}@exemplo.teste`;
}

async function criarUsuario(usuarioId: string) {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (jaExiste) {
    // Repetição automática do Playwright: volta ao ponto de partida (sem "agora não" nem instalação gravados).
    await db()
      .update(preferenciasUsuario)
      .set({ conviteInstalarAdiadoAte: null, instaladoEm: null })
      .where(eq(preferenciasUsuario.usuarioId, usuarioId));
    return;
  }
  const [nicho] = await db().insert(nichos).values({ slug: `${usuarioId}-nicho`, nome: "[teste] Oficina" }).returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Instalar", email: email(usuarioId) });
  await db()
    .insert(account)
    .values({
      id: `${usuarioId}-credential`,
      issuer: "local:credential",
      accountId: usuarioId,
      providerId: "credential",
      userId: usuarioId,
      password: await hashPassword(SENHA),
    });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Instalar ${usuarioId}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "conserto de eletrodomésticos",
          preco: "revisão simples por R$ 90",
          clienteIdeal: "mora perto da oficina",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "conserta eletrodomésticos na oficina própria",
        referencias: [],
      },
    });
}

async function entrar(page: Page, usuarioId: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(usuarioId));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** O primeiro roteiro, pelo caminho "Gravar agora" (não depende de tema do dia, mesma lição de `momento.spec.ts`). */
async function gerarRoteiro(page: Page) {
  await page.goto("/criar");
  await page.getByRole("button", { name: "Contar o momento" }).click();
  const folha = page.getByRole("dialog", { name: "Gravar agora" });
  await expect(folha).toBeVisible();
  await folha.getByLabel("Onde você está").fill("na oficina");
  await folha.getByLabel("O que está acontecendo").fill("consertando uma peça na bancada");
  await folha.getByLabel("O que dá para mostrar").fill("a peça pronta no fim");
  await folha.getByRole("button", { name: "Que muita gente veja" }).click();
  await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
  await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
}

/** O pedido de instalação que o Chromium manda: um evento com `prompt` e `userChoice`; `window.__pedidoChamado` diz se o botão o usou. */
async function dispararPedidoDeInstalacao(page: Page) {
  await page.evaluate(() => {
    const evento = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
    evento.prompt = async () => {
      (window as unknown as { __pedidoChamado: boolean }).__pedidoChamado = true;
    };
    evento.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(evento);
  });
}

test.describe("convite de instalar: Android", () => {
  test.use({ userAgent: UA_ANDROID, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    await criarUsuario("e2e-instalar-android");
  });

  test("não aparece no login; depois do primeiro roteiro abre com o botão, que usa o pedido do navegador", async ({ page }) => {
    await entrar(page, "e2e-instalar-android");
    // No login e na primeira tela: nada.
    await page.waitForTimeout(2500);
    await expect(page.getByRole("dialog", { name: TITULO_CONVITE })).toHaveCount(0);

    await gerarRoteiro(page);
    await dispararPedidoDeInstalacao(page);

    const convite = page.getByRole("dialog", { name: TITULO_CONVITE });
    await expect(convite).toBeVisible({ timeout: 8000 });
    await expect(convite.getByRole("button", { name: "Adicionar ao celular" })).toBeVisible();
    await expect(convite.getByRole("button", { name: "Agora não" })).toBeVisible();

    await convite.getByRole("button", { name: "Adicionar ao celular" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pedidoChamado?: boolean }).__pedidoChamado === true)).toBe(true);
    await expect(convite).toHaveCount(0);
  });

  test("sem o pedido do navegador, caem as instruções escritas (sem botão)", async ({ page }) => {
    await criarUsuario("e2e-instalar-android");
    await entrar(page, "e2e-instalar-android");
    await gerarRoteiro(page);

    const convite = page.getByRole("dialog", { name: TITULO_CONVITE });
    await expect(convite).toBeVisible({ timeout: 8000 });
    await expect(convite.getByText("escolha Instalar aplicativo")).toBeVisible();
    await expect(convite.getByRole("button", { name: "Adicionar ao celular" })).toHaveCount(0);
  });

  test("a Conta ganha o botão quando o navegador deixa instalar", async ({ page }) => {
    await entrar(page, "e2e-instalar-android");
    await page.goto("/conta");
    const cartao = page.getByTestId("instalar-no-celular");
    await expect(cartao).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Adicionar ao celular" })).toHaveCount(0);

    await dispararPedidoDeInstalacao(page);
    await expect(cartao.getByRole("button", { name: "Adicionar ao celular" })).toBeVisible();
    await cartao.getByRole("button", { name: "Adicionar ao celular" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pedidoChamado?: boolean }).__pedidoChamado === true)).toBe(true);
  });
});

test.describe("convite de instalar: iPhone", () => {
  test.use({ userAgent: UA_IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    await criarUsuario("e2e-instalar-iphone");
  });

  test("os dois passos, sem botão de instalar; 'Agora não' guarda a data no servidor e a folha não volta na recarga", async ({ page, baseURL }) => {
    await criarUsuario("e2e-instalar-iphone");
    await entrar(page, "e2e-instalar-iphone");
    await gerarRoteiro(page);

    const convite = page.getByRole("dialog", { name: TITULO_CONVITE });
    await expect(convite).toBeVisible({ timeout: 8000 });
    await expect(convite.locator("[data-convite-instalar='iphone'] li")).toHaveCount(2);
    await expect(convite.getByText("botão de Compartilhar")).toBeVisible();
    await expect(convite.getByText("Adicionar à Tela de Início")).toBeVisible();
    await expect(convite.getByRole("button", { name: "Adicionar ao celular" })).toHaveCount(0);

    await convite.getByRole("button", { name: "Agora não" }).click();
    await expect(convite).toHaveCount(0);

    // A data foi para o servidor: uns sete dias à frente.
    await expect
      .poll(async () => {
        const [prefs] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, "e2e-instalar-iphone"));
        if (!prefs?.conviteInstalarAdiadoAte) return null;
        const dias = (prefs.conviteInstalarAdiadoAte.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        return dias > 6.9 && dias < 7.1;
      })
      .toBe(true);

    await page.reload();
    await page.waitForTimeout(3000);
    await expect(page.getByRole("dialog", { name: TITULO_CONVITE })).toHaveCount(0);

    // E em outro aparelho (outro contexto, mesma pessoa) também não volta: a data é da pessoa, não do navegador.
    const outro = await page.context().browser()!.newContext({ baseURL, userAgent: UA_ANDROID, viewport: { width: 390, height: 844 }, isMobile: true });
    const paginaDois = await outro.newPage();
    await paginaDois.goto("/entrar");
    await paginaDois.getByLabel("E-mail").fill(email("e2e-instalar-iphone"));
    await paginaDois.getByLabel("Senha").fill(SENHA);
    await paginaDois.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(paginaDois).toHaveURL(/\/hoje/);
    await paginaDois.goto(page.url());
    await paginaDois.waitForTimeout(3000);
    await expect(paginaDois.getByRole("dialog", { name: TITULO_CONVITE })).toHaveCount(0);
    await outro.close();
  });

  test("a Conta não ganha botão no iPhone (só os passos)", async ({ page }) => {
    await entrar(page, "e2e-instalar-iphone");
    await page.goto("/conta");
    const cartao = page.getByTestId("instalar-no-celular");
    await expect(cartao).toBeVisible();
    // O iPhone nunca manda o pedido de instalação: só os passos escritos, nunca o botão.
    await expect(cartao.getByText("Compartilhar")).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Adicionar ao celular" })).toHaveCount(0);
  });
});

test.describe("convite de instalar: já instalado", () => {
  test.use({ userAgent: UA_IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    await criarUsuario("e2e-instalar-instalado");
  });

  test("em modo aplicativo não há convite, e a primeira abertura grava 'instalou', que o admin vê", async ({ page, browser, baseURL }) => {
    await criarUsuario("e2e-instalar-instalado");
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    });
    await entrar(page, "e2e-instalar-instalado");
    await gerarRoteiro(page);
    await page.waitForTimeout(3000);
    await expect(page.getByRole("dialog", { name: TITULO_CONVITE })).toHaveCount(0);

    await expect
      .poll(async () => {
        const [prefs] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, "e2e-instalar-instalado"));
        return prefs?.instaladoEm !== null && prefs?.instaladoEm !== undefined;
      })
      .toBe(true);
    const [antes] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, "e2e-instalar-instalado"));

    // Abrir de novo não muda a data.
    await page.reload();
    await page.waitForTimeout(1500);
    const [depois] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, "e2e-instalar-instalado"));
    expect(depois.instaladoEm?.getTime()).toBe(antes.instaladoEm?.getTime());

    // O admin vê a coluna "instalou" com a data desta marca.
    const contextoAdmin = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    const admin = await contextoAdmin.newPage();
    await admin.goto("/entrar");
    await admin.getByLabel("E-mail").fill("admin@exemplo.teste");
    await admin.getByLabel("Senha").fill(SENHA);
    await admin.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(admin).toHaveURL(/\/admin/);
    await admin.goto("/admin/clientes");
    const linha = admin.locator("tr", { hasText: "[teste] Instalar e2e-instalar-instalado" });
    await expect(linha.locator("[data-instalou='sim']")).toBeVisible();
    const linhaOutra = admin.locator("tr", { hasText: "[teste] Instalar e2e-instalar-iphone" });
    if ((await linhaOutra.count()) > 0) await expect(linhaOutra.locator("[data-instalou='nao']")).toBeVisible();
    await contextoAdmin.close();
  });
});

test.describe("convite de instalar: computador", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeAll(async () => {
    await criarUsuario("e2e-instalar-desktop");
  });

  test("no computador não há convite", async ({ page }) => {
    await criarUsuario("e2e-instalar-desktop");
    await entrar(page, "e2e-instalar-desktop");
    await gerarRoteiro(page);
    await page.waitForTimeout(3000);
    await expect(page.getByRole("dialog", { name: TITULO_CONVITE })).toHaveCount(0);
  });
});
