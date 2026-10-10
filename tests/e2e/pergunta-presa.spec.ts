/**
 * A pergunta do público presa ao Tema livre (E28, parte 3): "Responder em vídeo" abre o Tema livre com a pergunta no alto (com quantas vezes e de onde foi lida), o campo "Como você responde?",
 * "Tirar a pergunta" que devolve o Tema livre comum, a nota de sempre e o roteiro que nasce respondendo a ela (a cópia fica no roteiro). Chave que não é de uma voz do setor da marca abre o Tema
 * livre comum.
 */
import { expect, test } from "@playwright/test";
import { desc, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { roteiros } from "../../src/db/schema";

import { ficarComAPrimeiraVersao } from "./ajudas-versoes";
import { entrar, PERGUNTA_PADRAO, prepararMarcaComVozes } from "./ajudas-vozes";

const MARCADOR_NOTA = "aprova este tema de teste sem ressalva";

test.describe("a pergunta do público no Tema livre", () => {
  test("a pergunta fica presa no alto, com as vezes e de onde foi lida; 'Tirar a pergunta' devolve o Tema livre comum", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, chaveDaPergunta } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto(`/criar/tema-livre?pergunta=${chaveDaPergunta}`);

    const presa = page.locator("[data-pergunta-presa]");
    await expect(presa).toBeVisible();
    await expect(presa).toContainText("O público pergunta");
    await expect(presa.getByRole("heading", { name: PERGUNTA_PADRAO, level: 3 })).toBeVisible();
    await expect(presa).toContainText("perguntado 14 vezes");
    await expect(presa).toContainText("nos comentários de vídeos do YouTube do seu setor, lidos em");
    await expect(page.getByRole("heading", { name: "Responder o que estão perguntando", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Como você responde?")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "a pergunta criou rolagem para o lado").toBe(true);

    await presa.getByRole("button", { name: "Tirar a pergunta" }).click();
    await expect(page.locator("[data-pergunta-presa]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?", level: 1 })).toBeVisible();

    // tirar a pergunta é estado da tela (a URL do Tema livre não muda, como em "Tirar a notícia"): o que segue adiante não leva a chave e o roteiro nasce de um tema livre comum
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=/);
    expect(page.url()).not.toContain("pergunta=");
  });

  test("a reclamação tem o mesmo desenho, com o rótulo dela", async ({ page }) => {
    const { email, chaveDaReclamacao } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto(`/criar/tema-livre?pergunta=${chaveDaReclamacao}`);
    const presa = page.locator("[data-pergunta-presa]");
    await expect(presa).toContainText("O público reclama");
    await expect(presa).toContainText("reclamado 7 vezes");
    await expect(page.getByRole("heading", { name: "Responder o que estão reclamando", level: 1 })).toBeVisible();
    await expect(presa.getByRole("button", { name: "Tirar a reclamação" })).toBeVisible();
  });

  test("uma chave que não é de uma voz do setor da marca abre o Tema livre comum, sem erro", async ({ page }) => {
    const { email } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar/tema-livre?pergunta=000000000000");
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?", level: 1 })).toBeVisible();
    await expect(page.locator("[data-pergunta-presa]")).toHaveCount(0);
  });

  test("a marca de um setor sem vozes também abre o Tema livre comum, sem parecer erro", async ({ page }) => {
    const { email, chaveDaPergunta } = await prepararMarcaComVozes({ semVozes: true });
    await entrar(page, email);
    await page.goto(`/criar/tema-livre?pergunta=${chaveDaPergunta}`);
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?", level: 1 })).toBeVisible();
    await expect(page.locator("[data-pergunta-presa]")).toHaveCount(0);
  });

  test("a pergunta vai do Tema livre até o roteiro: a nota, o Objetivo com a chave, e o roteiro guarda a pergunta de onde nasceu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { email, marcaId, chaveDaPergunta } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto(`/criar/tema-livre?pergunta=${chaveDaPergunta}`);
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Como você responde?").fill(MARCADOR_NOTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(new RegExp(`/criar/objetivo\\?livre=.*&pergunta=${chaveDaPergunta}`));
    await page.locator("[data-fichas]").getByRole("radio", { name: /Que me chamem/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await ficarComAPrimeiraVersao(page);
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });

    const [roteiro] = await db().select({ pergunta: roteiros.perguntaDoPublico }).from(roteiros).where(eq(roteiros.clienteId, marcaId)).orderBy(desc(roteiros.id)).limit(1);
    expect(roteiro.pergunta).toMatchObject({ chave: chaveDaPergunta, texto: PERGUNTA_PADRAO, vezes: 14, tipo: "duvida", plataformas: ["youtube"] });
  });
});
