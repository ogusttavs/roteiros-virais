/**
 * "Vozes do público" no admin do setor (E28, parte 4): o que o público do setor disse nos comentários da semana, de quando é a leitura e se ainda vale, o que ficou abaixo do piso e o link do
 * vídeo de onde a voz veio. O setor sem leitura mostra o estado calmo, sem parecer erro. Um ramo por teste (o que `prepararMarcaComVozes` cria), com o vídeo dele.
 */
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { nichos, videos, type VozesDoSetor } from "../../src/db/schema";

import { PERGUNTA_PADRAO, prepararMarcaComVozes } from "./ajudas-vozes";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const DIA_MS = 24 * 60 * 60 * 1000;

async function entrarComoAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

async function ramoComVideoDaVoz(opcoes: Parameters<typeof prepararMarcaComVozes>[0] = {}) {
  const preparo = await prepararMarcaComVozes(opcoes);
  const [nicho] = await db().select({ slug: nichos.slug, vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, preparo.nichoId));
  const sufixo = `${test.info().testId}-r${test.info().retry}`;
  const [video] = await db()
    .insert(videos)
    .values({ plataforma: "youtube", idExterno: `e2e-vozes-admin-${sufixo}`, url: `https://exemplo.invalido/e2e-vozes-admin-${sufixo}`, nichoId: preparo.nichoId, titulo: `Vídeo das vozes ${sufixo}` })
    .returning();
  if (nicho.vozes) {
    const comVideo: VozesDoSetor = { ...nicho.vozes, duvidas: nicho.vozes.duvidas.map((d) => ({ ...d, videos: [video.id] })) };
    await db().update(nichos).set({ vozes: comVideo }).where(eq(nichos.id, preparo.nichoId));
  }
  return { ...preparo, slug: nicho.slug, video, sufixo };
}

test.describe("as vozes do público no admin do setor", () => {
  test("mostra a leitura da semana, o que passou do piso e o que ficou de fora, com o link do vídeo", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { slug, video, sufixo } = await ramoComVideoDaVoz({
      duvidas: [
        { texto: PERGUNTA_PADRAO, vezes: 14, videos: [1], plataformas: ["youtube"] },
        { texto: "Pergunta de três comentários?", vezes: 3, videos: [1], plataformas: ["youtube"] },
      ],
      objecoes: [{ texto: "A mancha voltou depois de secar", vezes: 7, videos: [1], plataformas: ["youtube"] }],
    });
    await entrarComoAdmin(page);
    await page.goto(`/admin/nichos/${slug}`);

    const secao = page.locator("[data-vozes-do-publico]");
    await expect(secao).toHaveAttribute("data-vozes-do-publico", "vale");
    await expect(secao.getByRole("heading", { name: "vozes do público", level: 2 })).toBeVisible();
    await expect(secao.locator("[data-vozes-leitura]")).toContainText("de 840 comentários de 12 vídeos do YouTube, lidos em");
    await expect(secao.locator("[data-vozes-validade]")).toContainText("vale até");

    const boa = secao.getByRole("row").filter({ hasText: PERGUNTA_PADRAO });
    await expect(boa).toContainText("14");
    await expect(boa).toContainText("passou do piso");
    await expect(boa.getByRole("link", { name: `ver vídeo 1: Vídeo das vozes ${sufixo}` })).toHaveAttribute("href", video.url);

    const fraca = secao.getByRole("row").filter({ hasText: "Pergunta de três comentários?" });
    await expect(fraca).toContainText("abaixo do piso de 5");
    await expect(secao.getByRole("row").filter({ hasText: "A mancha voltou depois de secar" })).toContainText("7");
    await expect(secao.getByText("nenhuma nesta leitura")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "a seção criou rolagem para o lado").toBe(true);
  });

  test("no ramo sem leitura, a seção explica a rotina e não parece erro", async ({ page }) => {
    const { slug } = await ramoComVideoDaVoz({ semVozes: true });
    await entrarComoAdmin(page);
    await page.goto(`/admin/nichos/${slug}`);
    const secao = page.locator("[data-vozes-do-publico]");
    await expect(secao).toHaveAttribute("data-vozes-do-publico", "sem");
    await expect(secao).toContainText("ainda sem vozes neste ramo");
    await expect(secao.getByRole("table")).toHaveCount(0);
    await expect(page.locator("main [role='alert']")).toHaveCount(0);
  });

  test("a leitura de mais de duas semanas diz que é velha e que já não entra nos temas nem no roteiro", async ({ page }) => {
    const { slug, nichoId } = await ramoComVideoDaVoz();
    await db()
      .update(nichos)
      .set({ vozesEm: new Date(Date.now() - 20 * DIA_MS) })
      .where(eq(nichos.id, nichoId));
    await entrarComoAdmin(page);
    await page.goto(`/admin/nichos/${slug}`);
    const secao = page.locator("[data-vozes-do-publico]");
    await expect(secao).toHaveAttribute("data-vozes-do-publico", "velha");
    await expect(secao.locator("[data-vozes-validade]")).toContainText("leitura velha");
    await expect(secao.locator("[data-vozes-validade]")).toContainText("já não entra nos temas nem no roteiro");
    // a lista continua à vista: o admin vê o que foi lido mesmo depois de vencer, e a linha não diz que ainda é usada
    const linha = secao.getByRole("row").filter({ hasText: PERGUNTA_PADRAO });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("passou do piso, leitura velha");
  });
});
