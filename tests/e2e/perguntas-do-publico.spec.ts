/**
 * "O que o público pergunta" nas telas (E28, parte 3b, passo 25 do Opus): a quinta porta do Criar (com o estado calmo quando o setor fechou a semana sem voz), o bloco depois dos três temas
 * (na porta "Os temas de hoje"), a linha fechada e o bloco aberto das Referências, e o toque em "Responder" que leva ao Tema livre com a pergunta presa. A frase do pé conta o que foi lido
 * (quantos vídeos, de qual plataforma, em que dia): o público de um vídeo do YouTube não é o do Reels.
 */
import { expect, test } from "@playwright/test";

import { entrar, PERGUNTA_PADRAO, prepararMarcaComVozes } from "./ajudas-vozes";

test.describe("o Criar: a quinta porta", () => {
  test("lista as perguntas com as vezes e a frase da leitura; Responder abre o Tema livre com a pergunta presa", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, chaveDaPergunta } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar");

    const porta = page.locator("[data-porta-perguntas='com']");
    await expect(porta).toBeVisible();
    await expect(porta.getByText("Responder o que estão perguntando")).toBeVisible();
    await expect(porta.getByText(PERGUNTA_PADRAO)).toBeVisible();
    await expect(porta.getByText("perguntado 14 vezes")).toBeVisible();
    await expect(porta.getByText("reclamado 7 vezes")).toBeVisible();
    await expect(porta).toContainText("Dos comentários dos 12 vídeos mais vistos do seu setor no YouTube, lidos em");
    await expect(porta).toContainText("ninguém é citado pelo nome");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "a porta criou rolagem para o lado").toBe(true);

    await porta.getByRole("button", { name: `Responder: ${PERGUNTA_PADRAO}` }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/tema-livre\\?pergunta=${chaveDaPergunta}`));
    await expect(page.locator("[data-pergunta-presa]")).toBeVisible();
  });

  test("no setor que fechou a semana sem voz, a porta fica calma: uma frase, sem botão e sem aparência de erro", async ({ page }) => {
    const { email } = await prepararMarcaComVozes({ semVozes: true });
    await entrar(page, email);
    await page.goto("/criar");
    const porta = page.locator("[data-porta-perguntas='sem']");
    await expect(porta).toBeVisible();
    await expect(porta).toContainText("Ainda sem perguntas do público.");
    await expect(porta.getByRole("button")).toHaveCount(0);
    // o anunciador de rota do Next também tem role="alert": só conta o que é da tela
    await expect(page.locator("main [role='alert']")).toHaveCount(0);
  });

  test("uma pergunta abaixo do piso de cinco comentários não aparece", async ({ page }) => {
    const { email } = await prepararMarcaComVozes({
      duvidas: [{ texto: "Pergunta de poucos comentários?", vezes: 4, videos: [1], plataformas: ["youtube"] }],
      objecoes: [],
    });
    await entrar(page, email);
    await page.goto("/criar");
    await expect(page.locator("[data-porta-perguntas='sem']")).toBeVisible();
    await expect(page.getByText("Pergunta de poucos comentários?")).toHaveCount(0);
  });
});

test.describe("as Referências: a linha e o bloco", () => {
  test("a linha fechada mostra a mais perguntada; 'Ver as perguntas' abre o bloco e 'Recolher' fecha", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { email } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/referencias");

    const linha = page.locator("[data-perguntas-linha]");
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("a mais feita, 14 vezes");
    await expect(linha).toContainText(PERGUNTA_PADRAO);

    await expect(linha.getByRole("button", { name: "Ver as perguntas" })).toHaveAttribute("aria-expanded", "false");
    await linha.getByRole("button", { name: "Ver as perguntas" }).click();
    const bloco = page.locator("[data-perguntas-do-publico]");
    await expect(bloco).toBeVisible();
    await expect(bloco.getByRole("heading", { name: "O que o público pergunta", level: 2 })).toBeVisible();
    await expect(bloco.getByRole("button", { name: `Responder em vídeo: ${PERGUNTA_PADRAO}` })).toBeVisible();
    await expect(page.locator("[data-perguntas-linha]")).toHaveCount(0);
    // o foco acompanha o gesto: quem abriu com o teclado cai no botão que fecha
    await expect(bloco.getByRole("button", { name: "Recolher" })).toBeFocused();
    await expect(bloco.getByRole("button", { name: "Recolher" })).toHaveAttribute("aria-expanded", "true");

    await bloco.getByRole("button", { name: "Recolher" }).click();
    await expect(page.locator("[data-perguntas-linha]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver as perguntas" })).toBeFocused();
  });

  test("no setor sem voz, a linha nem aparece", async ({ page }) => {
    const { email } = await prepararMarcaComVozes({ semVozes: true });
    await entrar(page, email);
    await page.goto("/referencias");
    await expect(page.getByRole("heading", { name: "O que está funcionando no seu setor", level: 1 })).toBeVisible();
    await expect(page.locator("[data-perguntas-linha]")).toHaveCount(0);
    await expect(page.locator("[data-perguntas-do-publico]")).toHaveCount(0);
  });

  test("Responder em vídeo, no bloco aberto, leva ao Tema livre com a pergunta presa", async ({ page }) => {
    const { email, chaveDaPergunta } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/referencias");
    await page.locator("[data-perguntas-linha]").getByRole("button", { name: "Ver as perguntas" }).click();
    await page.getByRole("button", { name: `Responder em vídeo: ${PERGUNTA_PADRAO}` }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/tema-livre\\?pergunta=${chaveDaPergunta}`));
  });
});

test.describe("a porta dos temas de hoje", () => {
  test("o bloco vem depois dos três temas, com a frase da leitura; Responder em vídeo leva ao Tema livre com a pergunta presa", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, chaveDaPergunta } = await prepararMarcaComVozes({ comTemas: true });
    await entrar(page, email);
    await page.goto("/criar/temas");

    await expect(page.getByText("Tema de teste 1 do setor")).toBeVisible();
    const bloco = page.locator("[data-perguntas-do-publico]");
    await expect(bloco).toBeVisible();
    await expect(bloco.getByRole("heading", { name: "O que o público pergunta", level: 3 })).toBeVisible();
    await expect(bloco).toContainText("Dos comentários dos 12 vídeos mais vistos do seu setor no YouTube");
    const caixaDoUltimoTema = await page.getByText("Tema de teste 3 do setor").boundingBox();
    const caixaDoBloco = await bloco.boundingBox();
    expect(caixaDoBloco!.y).toBeGreaterThan(caixaDoUltimoTema!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "o bloco criou rolagem para o lado").toBe(true);

    await bloco.getByRole("button", { name: `Responder em vídeo: ${PERGUNTA_PADRAO}` }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/tema-livre\\?pergunta=${chaveDaPergunta}`));
  });

  test("no setor sem voz, os temas aparecem como sempre e o bloco nem existe", async ({ page }) => {
    const { email } = await prepararMarcaComVozes({ comTemas: true, semVozes: true });
    await entrar(page, email);
    await page.goto("/criar/temas");
    await expect(page.getByText("Tema de teste 1 do setor")).toBeVisible();
    await expect(page.locator("[data-perguntas-do-publico]")).toHaveCount(0);
  });
});
