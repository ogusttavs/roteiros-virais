/**
 * "Vídeos longos do YouTube" no admin do setor (E52, PR 1): o que o banco já sabe dos longos do ramo sem transcrever nenhum (a duração típica, a estrutura que os donos escreveram na
 * descrição, o tamanho da amostra dito) e os longos da janela. O ramo sem longo mostra o estado calmo, sem parecer erro. Um ramo por teste; os vídeos são inventados.
 */
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { nichos, videos } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const DIA_MS = 24 * 60 * 60 * 1000;
const SLUG_COM = "e2e-longos-com";
const SLUG_SEM = "e2e-longos-sem";

async function entrarComoAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

async function criarRamo(slug: string): Promise<number> {
  const [ramo] = await db().insert(nichos).values({ slug, nome: `[teste e2e] ${slug}`, termos: [] }).returning();
  return ramo.id;
}

function lista(...inicios: number[]): string {
  return ["Neste vídeo eu mostro o passo a passo.", ...inicios.map((s, i) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} Capítulo ${i + 1}`)].join("\n");
}

test.describe("os vídeos longos no admin do setor", () => {
  test.afterAll(async () => {
    const ramos = await db().select({ id: nichos.id }).from(nichos).where(inArray(nichos.slug, [SLUG_COM, SLUG_SEM]));
    const ids = ramos.map((r) => r.id);
    if (ids.length > 0) {
      await db().delete(videos).where(inArray(videos.nichoId, ids));
      await db().delete(nichos).where(inArray(nichos.id, ids));
    }
  });

  test("mostra a amostra dita como indício, a duração e a estrutura típicas e só os longos, com o link", async ({ page }) => {
    const nichoId = await criarRamo(SLUG_COM);
    const publicado = new Date(Date.now() - 4 * DIA_MS);
    const semear = (idExterno: string, duracaoS: number, descricao: string | null, views: number) =>
      db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno,
          url: `https://exemplo.invalido/${idExterno}`,
          nichoId,
          titulo: `[exemplo] ${idExterno}`,
          descricao,
          views,
          duracaoS,
          publicadoEm: publicado,
          idioma: "pt",
        })
        .returning();
    await semear("e2e-longo-a", 300, lista(0, 100, 200), 400_000);
    await semear("e2e-longo-b", 480, lista(0, 160, 320), 300_000);
    await semear("e2e-longo-c", 600, lista(0, 200, 400), 200_000);
    await semear("e2e-longo-d", 720, null, 100_000);
    await semear("e2e-curto", 45, null, 900_000);
    await semear("e2e-aovivo", 50 * 60, null, 800_000);

    await page.setViewportSize({ width: 1280, height: 900 });
    await entrarComoAdmin(page);
    await page.goto(`/admin/nichos/${SLUG_COM}`);

    const secao = page.locator("[data-longos-do-setor]");
    await expect(secao).toHaveAttribute("data-longos-do-setor", "indicio");
    await expect(secao.getByRole("heading", { name: "vídeos longos do YouTube", level: 2 })).toBeVisible();
    await expect(secao.locator("[data-longos-medida]")).toContainText("4 vídeos longos nos últimos 90 dias");
    await expect(secao.locator("[data-longos-medida]")).toContainText("ainda é indício");
    await expect(secao.locator("[data-longos-duracao]")).toHaveText("duração típica: de 7 a 11 minutos, a mediana é 9");
    await expect(secao.locator("[data-longos-estrutura]")).toHaveText("3 de 4 têm a lista de capítulos na descrição: em geral 3 capítulos, de uns 3 minutos cada (ainda é indício)");
    await expect(secao.locator("[data-longos-lidos]")).toContainText("lidos por transcrição nesta semana: 0; o limite é de 5 por semana");

    // só os quatro longos, o mais visto no alto (o fora da curva não foi medido nestes vídeos); o curto e o ao vivo ficam de fora
    await expect(secao.locator("[data-longo]")).toHaveCount(4);
    await expect(secao.getByRole("link", { name: "[exemplo] e2e-longo-a" })).toHaveAttribute("href", "https://exemplo.invalido/e2e-longo-a");
    await expect(secao.getByText("[exemplo] e2e-curto")).toHaveCount(0);
    await expect(secao.getByText("[exemplo] e2e-aovivo")).toHaveCount(0);
    const primeira = secao.locator("[data-longo]").first();
    await expect(primeira).toContainText("5 min");
    await expect(primeira).toContainText("400.000");
    await expect(primeira).toContainText("3 capítulos");
    await expect(secao.locator("[data-longo]").last()).toContainText("sem lista");

    for (const largura of [1280, 390]) {
      await page.setViewportSize({ width: largura, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `a seção criou rolagem para o lado a ${largura}`).toBe(true);
    }
  });

  test("no ramo sem vídeo longo, a seção diz o que entra e não parece erro", async ({ page }) => {
    await criarRamo(SLUG_SEM);
    await entrarComoAdmin(page);
    await page.goto(`/admin/nichos/${SLUG_SEM}`);
    const secao = page.locator("[data-longos-do-setor]");
    await expect(secao).toHaveAttribute("data-longos-do-setor", "nenhuma");
    await expect(secao).toContainText("ainda sem vídeo longo neste ramo nos últimos 90 dias");
    await expect(secao).toContainText("mais de 3 minutos e até 40 minutos");
    await expect(secao.getByRole("table")).toHaveCount(0);
    await expect(page.locator("main [role='alert']")).toHaveCount(0);
    // o ramo existe como os outros: a página não caiu
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect((await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, SLUG_SEM))).length).toBe(1);
  });
});
