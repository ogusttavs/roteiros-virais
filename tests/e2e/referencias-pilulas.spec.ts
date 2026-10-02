/**
 * As pílulas de filtro à vista em Referências, do tablet deitado para cima (1024px ou mais;
 * `PROXIMO.md`, "a partir de 1024"): cada filtro vira uma pílula com um menu suspenso acessível
 * (`useMenuSuspenso`, `src/ui/componentes/`, genérico de propósito), em vez do botão "Filtrar"
 * mais a folha. Abaixo de 1024px nada muda: o botão "Filtrar", a folha e as fichas continuam os
 * mesmos de sempre (`referencias-r2b.spec.ts`, `referencias.spec.ts`).
 *
 * Roteiro próprio, nicho isolado (mesma lição de `referencias-r2b.spec.ts`): um conjunto de
 * vídeos só deste arquivo, para não disputar contagem com o resto da suíte.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contas, membrosMarca, nichos, preferenciasUsuario, user, videos } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-referencias-pilulas@exemplo.teste";
const SLUG_NICHO = "e2e-referencias-pilulas-nicho";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

function analiseExemplo(assunto: string, formato: "fala_para_camera" | "podcast" = "fala_para_camera") {
  return {
    assunto,
    gancho: "gancho",
    estrutura: "estrutura",
    fechamento: "fechamento",
    chamadaFinal: "chamada",
    formato,
    porQueFuncionou: "x",
  };
}

test.describe("/referencias, as pílulas de filtro à vista a partir de 1024px", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-referencias-pilulas"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: SLUG_NICHO, nome: "[teste] Referências pílulas", termos: [] }).returning();
    const [contaTiktok] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "@e2e-pilulas-tiktok", nome: "[teste] Conta TikTok", nichoId: nicho.id })
      .returning();
    const [contaInstagram] = await db()
      .insert(contas)
      .values({ plataforma: "instagram", handle: "@e2e-pilulas-instagram", nome: "[teste] Conta Instagram", nichoId: nicho.id })
      .returning();

    await db().insert(user).values({ id: "e2e-referencias-pilulas", name: "[teste] Referências pílulas", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-referencias-pilulas-credential",
        issuer: "local:credential",
        accountId: "e2e-referencias-pilulas",
        providerId: "credential",
        userId: "e2e-referencias-pilulas",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-referencias-pilulas", aceitouTermosEm: new Date() });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-referencias-pilulas", nome: "[teste] Referências pílulas", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-referencias-pilulas", clienteId: cliente.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });

    await db()
      .insert(videos)
      .values([
        {
          plataforma: "tiktok",
          idExterno: "e2e-pilulas-tiktok-br",
          url: "https://exemplo.invalido/e2e-pilulas-tiktok-br",
          nichoId: nicho.id,
          contaId: contaTiktok.id,
          titulo: "video do tiktok, do brasil, com fala",
          views: 60_000,
          foraDaCurva: "5.0",
          idioma: "pt",
          publicadoEm: new Date(Date.now() + 60_000),
          analise: analiseExemplo("video do tiktok com fala") as never,
        },
        {
          plataforma: "instagram",
          idExterno: "e2e-pilulas-instagram-fora",
          url: "https://exemplo.invalido/e2e-pilulas-instagram-fora",
          nichoId: nicho.id,
          contaId: contaInstagram.id,
          titulo: "video do instagram, de fora, sem fala, meme",
          // Abaixo de 10 mil de propósito: a pílula de Views (abaixo) separa os dois vídeos.
          views: 5_000,
          foraDaCurva: "3.0",
          idioma: "en",
          semFala: true,
          tipoConteudo: "meme",
          publicadoEm: new Date(Date.now() + 30_000),
          analise: analiseExemplo("video do instagram sem fala", "podcast") as never,
        },
      ]);
  });

  test("a 1280px, as pílulas substituem o botão Filtrar e as fichas, mesmo com um filtro ligado", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    await expect(page.getByRole("group", { name: "Ordem e filtros" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Filtrar", exact: false })).toBeHidden();

    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitemradio", { name: "Mais de 10 mil" }).click();
    await expect(page).toHaveURL(/views=10000/);

    // Mesmo com um filtro ligado (fichas apareceriam abaixo de 1024px), a pílula mostra o próprio
    // estado e nem o botão "Filtrar" nem as fichas aparecem.
    await expect(page.getByRole("button", { name: "Filtrar", exact: false })).toBeHidden();
    await expect(page.getByLabel("Filtros ligados")).toBeHidden();
    await expect(page.getByRole("button", { name: "Mais de 10 mil" })).toBeVisible();
  });

  test("abaixo de 1024px as pílulas não aparecem; o botão Filtrar e a folha continuam os mesmos", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    await expect(page.getByRole("group", { name: "Ordem e filtros" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Filtrar", exact: false })).toBeVisible();
  });

  test("a pílula de Views: abre um menu com role=menu e itens role=menuitemradio com a contagem, escolher fecha o menu e filtra", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    const pilulaViews = page.getByRole("button", { name: /^Views/ });
    await expect(pilulaViews).toHaveAttribute("aria-expanded", "false");
    await pilulaViews.click();
    await expect(pilulaViews).toHaveAttribute("aria-expanded", "true");

    const menu = page.getByRole("menu", { name: "Views" });
    await expect(menu).toBeVisible();
    const opcaoMaisDe10Mil = menu.getByRole("menuitemradio", { name: /Mais de 10 mil/ });
    await expect(opcaoMaisDe10Mil).toBeVisible();

    await opcaoMaisDe10Mil.click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/views=10000/);
    await expect(page.getByRole("button", { name: "Mais de 10 mil" })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(1);
  });

  test("a pílula de Rede: seleção múltipla, o menu continua aberto depois de marcar uma opção", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    await page.getByRole("button", { name: "Rede", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Onde foi postado" });
    const opcaoTiktok = menu.getByRole("menuitemcheckbox", { name: "TikTok" });
    await expect(opcaoTiktok).toHaveAttribute("aria-checked", "false");

    await opcaoTiktok.click();
    await expect(menu).toBeVisible();
    await expect(opcaoTiktok).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("plataforma")).toBe("tiktok");

    const opcaoInstagram = menu.getByRole("menuitemcheckbox", { name: "Instagram" });
    await opcaoInstagram.click();
    await expect(menu).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("plataforma")).toBe("tiktok,instagram");
  });

  test("Esc fecha o menu e devolve o foco para a pílula; um clique fora também fecha", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    const pilulaRede = page.getByRole("button", { name: "Rede", exact: true });
    await pilulaRede.click();
    const menu = page.getByRole("menu", { name: "Onde foi postado" });
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(pilulaRede).toBeFocused();

    await pilulaRede.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(menu).toBeHidden();
  });

  test("as setas navegam entre os itens do menu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    await page.getByRole("button", { name: /^Em que ordem/ }).click();
    const menu = page.getByRole("menu", { name: "Em que ordem" });
    await expect(menu.getByRole("menuitemradio").first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
  });

  test("só um menu fica aberto por vez: abrir outra pílula fecha a anterior", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas`);

    await page.getByRole("button", { name: /^Views/ }).click();
    await expect(page.getByRole("menu", { name: "Views" })).toBeVisible();

    await page.getByRole("button", { name: "Rede", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Views" })).toBeHidden();
    await expect(page.getByRole("menu", { name: "Onde foi postado" })).toBeVisible();
  });

  test("a pílula de Ordem fica separada das outras seis, perto da contagem, e não mexe no resto dos filtros", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/referencias?periodo=90&plataforma=todas&views=10000`);
    await expect(page.locator("article")).toHaveCount(1);

    await page.getByRole("button", { name: /^Em que ordem/ }).click();
    await page.getByRole("menuitemradio", { name: "Mais views", exact: true }).click();
    await expect(page).toHaveURL(/ordem=views/);
    await expect(page).toHaveURL(/views=10000/);
    await expect(page.locator("article")).toHaveCount(1);
  });
});
