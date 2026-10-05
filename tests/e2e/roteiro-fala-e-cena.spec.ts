/**
 * A fala e a cena juntas no roteiro (achado do Gustavo lendo o próprio roteiro, 05/10/2026): na leitura do Reels falado cada bloco de fala traz, no mesmo cartão, o "O que mostrar"
 * (a cena e o texto na tela daquele trecho) logo depois da fala; a seção "Onde gravar e o que mostrar" some da leitura. O Story fica como era (cartões e a seção de cenas), e o
 * teleprompter (o modo gravação) continua só com a fala, sem as cenas.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type ConteudoRoteiro } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-fala-cena@exemplo.teste";
const TEMA_REELS = "roteiro reels com fala e cena juntas";
const TEMA_STORY = "roteiro story com fala e cena";
let reelsId: number;
let storyId: number;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("fala e cena juntas na leitura do roteiro", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-fala-cena"));
    if (!existente) {
      const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
      await db().insert(user).values({ id: "e2e-fala-cena", name: "[teste] Fala e cena", email: EMAIL });
      await db().insert(account).values({ id: "e2e-fala-cena-credential", issuer: "local:credential", accountId: "e2e-fala-cena", providerId: "credential", userId: "e2e-fala-cena", password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-fala-cena", nome: "[teste] Fala e cena", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: "e2e-fala-cena", clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-fala-cena", aceitouTermosEm: new Date() });
      await db().insert(briefings).values({ clienteId: cliente.id, completo: true });

      const base = {
        ondeGravar: "na sala",
        edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: true,
        forcaEvidencia: null,
        porQueAssim: [],
      };
      const reels: ConteudoRoteiro = {
        ...base,
        titulo: TEMA_REELS,
        duracaoS: 40,
        gancho: "FALA DA ABERTURA",
        corpo: "FALA DO MEIO",
        fechamento: "FALA DO FECHAMENTO",
        chamadaFinal: "FALA DA CHAMADA",
        cartoes: null,
        cenas: [
          { momento: "0 a 3 s", oQueFazer: "CENA A abertura no balcao" },
          { momento: "8 a 15 s", oQueFazer: "CENA B meio mostrando o produto" },
          { momento: "28 a 32 s", oQueFazer: "CENA C fechamento com o resultado" },
          { momento: "36 a 40 s", oQueFazer: "CENA D chamada olhando para a camera" },
        ],
        edicao: {
          ...base.edicao,
          textoNaTela: [
            { quando: "1 s", oQue: "TEXTO DA ABERTURA", onde: "topo" },
            { quando: "30 s", oQue: "TEXTO DO FECHAMENTO", onde: "centro" },
          ],
        },
      };
      const story: ConteudoRoteiro = {
        ...base,
        titulo: TEMA_STORY,
        duracaoS: 20,
        gancho: "",
        corpo: "",
        fechamento: "",
        chamadaFinal: "",
        cartoes: [{ oQueFalar: "FALA DO STORY", oQueMostrar: "CENA DO STORY", textoNaTela: "TEXTO DO STORY", figurinha: "nenhuma" }],
        cenas: [{ momento: "abertura", oQueFazer: "CENA SOLTA DO STORY" }],
      };
      await db().insert(roteiros).values({ clienteId: cliente.id, data: "2026-01-01", tema: TEMA_REELS, origem: "sugerido", objetivo: "conversao", formato: "reels", estilo: "falado", conteudo: reels });
      await db().insert(roteiros).values({ clienteId: cliente.id, data: "2026-01-02", tema: TEMA_STORY, origem: "sugerido", objetivo: "conversao", formato: "story", estilo: "falado", conteudo: story });
    }
    const [r] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.tema, TEMA_REELS));
    const [s] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.tema, TEMA_STORY));
    reelsId = r.id;
    storyId = s.id;
  });

  test("Reels: a cena e o texto na tela de cada trecho ficam no bloco da fala, e a seção separada some", async ({ page }) => {
    await entrar(page);
    await page.goto(`/roteiros/${reelsId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const blocos = page.locator("[data-bloco-de-fala]");
    await expect(blocos).toHaveCount(4);
    const esperado = [
      { fala: "FALA DA ABERTURA", cena: "CENA A abertura no balcao", tela: "TEXTO DA ABERTURA", fora: ["CENA B", "CENA C", "CENA D"] },
      { fala: "FALA DO MEIO", cena: "CENA B meio mostrando o produto", tela: null, fora: ["CENA A", "CENA C", "CENA D"] },
      { fala: "FALA DO FECHAMENTO", cena: "CENA C fechamento com o resultado", tela: "TEXTO DO FECHAMENTO", fora: ["CENA A", "CENA B", "CENA D"] },
      { fala: "FALA DA CHAMADA", cena: "CENA D chamada olhando para a camera", tela: null, fora: ["CENA A", "CENA B", "CENA C"] },
    ];
    for (const [i, e] of esperado.entries()) {
      const bloco = blocos.nth(i);
      await expect(bloco).toContainText(e.fala);
      const cena = bloco.locator("[data-cena-do-bloco]");
      await expect(cena).toContainText("O que mostrar");
      await expect(cena).toContainText(e.cena);
      if (e.tela) await expect(cena).toContainText(e.tela);
      for (const outra of e.fora) await expect(bloco).not.toContainText(outra);
      // A cena vem DEPOIS da fala, no mesmo cartão.
      const texto = await bloco.innerText();
      expect(texto.indexOf(e.fala)).toBeLessThan(texto.indexOf(e.cena));
    }
    await expect(page.getByText("Onde gravar e o que mostrar")).toHaveCount(0);
    await expect(page.getByText("Como editar")).toBeVisible();
  });

  test("Reels no desktop: fala à esquerda e cena à direita no mesmo bloco", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/roteiros/${reelsId}`);
    const bloco = page.locator("[data-bloco-de-fala]").first();
    const fala = await bloco.getByText("FALA DA ABERTURA").boundingBox();
    const cena = await bloco.locator("[data-cena-do-bloco]").boundingBox();
    expect(fala && cena && cena.x > fala.x + fala.width - 1).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("Story não muda: cartão com o que mostrar e a seção 'Onde gravar e o que mostrar' continuam", async ({ page }) => {
    await entrar(page);
    await page.goto(`/roteiros/${storyId}`);
    await expect(page.getByText("FALA DO STORY")).toBeVisible();
    await expect(page.getByText("CENA DO STORY")).toHaveCount(1);
    await expect(page.getByText("Onde gravar e o que mostrar")).toBeVisible();
    await expect(page.locator("[data-cena-do-bloco]")).toHaveCount(0);
  });

  test("o teleprompter (modo gravação) segue só com a fala: sem as cenas", async ({ page }) => {
    await entrar(page);
    await page.goto(`/roteiros/${reelsId}/gravar`);
    await expect(page.getByText("FALA DA ABERTURA")).toBeVisible();
    await expect(page.getByText("CENA A")).toHaveCount(0);
    await expect(page.getByText("CENA D")).toHaveCount(0);
    await expect(page.getByText("O que mostrar")).toHaveCount(0);
  });
});
