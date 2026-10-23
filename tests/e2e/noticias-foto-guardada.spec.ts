/**
 * `/noticias` com e sem a foto da matéria guardada do nosso lado (fix de 22/10/2026), isolado do `noticias.spec.ts`: a notícia com foto guardada mostra a imagem pela rota própria
 * (`/api/imagem-noticia/<id>`) com o crédito do veículo; a sem foto mostra o quadro com o nome do veículo (nunca um buraco nem imagem quebrada); a foto guardada que sumiu cai no mesmo
 * quadro; a notícia velha, mesmo marcada relevante, nunca aparece; e a rota recusa quem não tem sessão. Grava tudo direto no banco (nenhuma rede). Com `CAPTURAS_NOTICIAS` apontando para
 * uma pasta, o último teste tira as capturas a 390 e 1280, nos dois temas.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, imagensNoticia, membrosMarca, nichos, noticias, preferenciasUsuario, user } from "../../src/db/schema";
import { inicioDoDiaEmSaoPaulo } from "../../src/servicos/noticias-do-dia";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-noticias-foto@exemplo.teste";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const TITULO_COM_FOTO = "[teste] matéria com a foto guardada do nosso lado";
const TITULO_SEM_FOTO = "[teste] matéria sem foto nenhuma, só o quadro do veículo";
const TITULO_FOTO_SUMIU = "[teste] matéria cuja foto guardada não abre mais";
const TITULO_VELHA = "[teste] matéria de dezembro que o Google News devolveu, relevante e velha";

let noticiaComFotoId = 0;
let noticiaFotoSumiuId = 0;

function hoje(minutosAtras: number): Date {
  return new Date(Math.max(Date.now() - minutosAtras * 60 * 1000, inicioDoDiaEmSaoPaulo(new Date()).getTime() + 60 * 1000));
}

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("/noticias com a foto da matéria guardada", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright: só cria na primeira vez.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-noticias-foto"));
    if (!jaExiste) {
      const [nicho] = await db().insert(nichos).values({ slug: "e2e-noticias-foto", nome: "[teste] Notícias com foto" }).returning();
      await db().insert(user).values({ id: "e2e-noticias-foto", name: "[teste] Notícias com foto", email: EMAIL });
      await db().insert(account).values({ id: "e2e-noticias-foto-credential", issuer: "local:credential", accountId: "e2e-noticias-foto", providerId: "credential", userId: "e2e-noticias-foto", password: await hashPassword(SENHA) });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-noticias-foto", aceitouTermosEm: new Date() });
      const [marca] = await db().insert(clientes).values({ usuarioId: "e2e-noticias-foto", nome: "[teste] Marca das fotos", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: "e2e-noticias-foto", clienteId: marca.id, papel: "dono" });
      await db().insert(briefings).values({
        clienteId: marca.id,
        completo: true,
        perfil: {
          fatos: { oQueVende: "kit", preco: "89", clienteIdeal: "x", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
          resumo: "marca de teste",
          referencias: [],
        },
      });

      const comFoto = { nichoId: nicho.id, fonte: "[teste] Jornal Exemplo", relevante: true, angulo: null, resumo: "Resumo nosso." };
      const [a, , c] = await db()
        .insert(noticias)
        .values([
          { ...comFoto, titulo: TITULO_COM_FOTO, url: "https://exemplo.invalido/e2e-foto-guardada", publicadoEm: hoje(20), imagemCredito: "Foto: [teste] Jornal Exemplo" },
          { ...comFoto, titulo: TITULO_SEM_FOTO, url: "https://exemplo.invalido/e2e-sem-foto", publicadoEm: hoje(40) },
          { ...comFoto, titulo: TITULO_FOTO_SUMIU, url: "https://exemplo.invalido/e2e-foto-sumiu", publicadoEm: hoje(60), imagemCredito: "Foto: [teste] Jornal Exemplo" },
          { ...comFoto, titulo: TITULO_VELHA, url: "https://exemplo.invalido/e2e-velha", publicadoEm: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
        ])
        .returning();
      await db().insert(imagensNoticia).values({ noticiaId: a.id, situacao: "guardada", tipo: "image/png", bytes: PNG_1X1, origem: "https://exemplo.invalido/foto.png" });
      // A "guardada" cujos bytes não são imagem: o navegador não consegue abrir, e o cartão cai no quadro.
      await db().insert(imagensNoticia).values({ noticiaId: c.id, situacao: "guardada", tipo: "image/png", bytes: Buffer.from("isto nao e uma imagem"), origem: "https://exemplo.invalido/quebrada.png" });
    }
    const linhas = await db().select({ id: noticias.id, titulo: noticias.titulo }).from(noticias);
    noticiaComFotoId = linhas.find((n) => n.titulo === TITULO_COM_FOTO)!.id;
    noticiaFotoSumiuId = linhas.find((n) => n.titulo === TITULO_FOTO_SUMIU)!.id;
    // Se a repetição automática rodou o cadastro antes, as de hoje precisam continuar sendo "de hoje".
    for (const [titulo, minutos] of [[TITULO_COM_FOTO, 20], [TITULO_SEM_FOTO, 40], [TITULO_FOTO_SUMIU, 60]] as const) {
      await db().update(noticias).set({ publicadoEm: hoje(minutos) }).where(eq(noticias.titulo, titulo));
    }
  });

  test("com foto guardada: a imagem vem da rota própria e abre, com o crédito do veículo", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");
    const cartao = page.locator("article", { hasText: TITULO_COM_FOTO });
    const foto = cartao.locator("img");
    await expect(foto).toHaveAttribute("src", `/api/imagem-noticia/${noticiaComFotoId}`);
    await expect(foto).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect.poll(() => foto.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(cartao.getByText("Foto: [teste] Jornal Exemplo")).toBeVisible();
  });

  test("sem foto: o quadro com o nome do veículo, nunca um buraco; a foto guardada que não abre cai no mesmo quadro", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    const semFoto = page.locator("article", { hasText: TITULO_SEM_FOTO });
    await expect(semFoto.locator("img")).toHaveCount(0);
    await expect(semFoto.locator("[class*='semFoto']").getByText("[teste] Jornal Exemplo", { exact: true })).toBeVisible();

    const sumiu = page.locator("article", { hasText: TITULO_FOTO_SUMIU });
    // A foto é preguiçosa (`loading="lazy"`): só tenta abrir, e só então falha, quando o cartão chega perto da tela.
    await sumiu.scrollIntoViewIfNeeded();
    await expect(sumiu.locator("img")).toHaveCount(0);
    await expect(sumiu.locator("[class*='semFoto']").getByText("[teste] Jornal Exemplo", { exact: true })).toBeVisible();
  });

  test("a notícia velha, mesmo relevante, nunca aparece", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");
    await expect(page.locator("article", { hasText: TITULO_COM_FOTO })).toBeVisible();
    await expect(page.getByText(TITULO_VELHA)).toHaveCount(0);
  });

  test("a rota da foto recusa quem não tem sessão e serve a quem tem, com o tipo certo", async ({ page, playwright, baseURL }) => {
    const anonimo = await playwright.request.newContext({ baseURL });
    // Sem cookie de sessão o middleware manda para a entrada (nunca chega nos bytes); a rota ainda confere a sessão de verdade (401), provado no teste de integração.
    const recusada = await anonimo.get(`/api/imagem-noticia/${noticiaComFotoId}`, { maxRedirects: 0 });
    expect(recusada.status()).toBe(307);
    expect(recusada.headers()["location"]).toBe("/entrar");
    expect(recusada.headers()["content-type"] ?? "").not.toContain("image/");
    await anonimo.dispose();

    await entrar(page);
    const servida = await page.request.get(`/api/imagem-noticia/${noticiaComFotoId}`);
    expect(servida.status()).toBe(200);
    expect(servida.headers()["content-type"]).toBe("image/png");
    expect(servida.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await servida.body()).length).toBe(PNG_1X1.length);
    expect((await page.request.get(`/api/imagem-noticia/${noticiaFotoSumiuId + 9999}`)).status()).toBe(404);
  });

  test("capturas a 390 e 1280, nos dois temas (só com CAPTURAS_NOTICIAS)", async ({ page }) => {
    const pasta = process.env.CAPTURAS_NOTICIAS;
    test.skip(!pasta, "só tira captura quando CAPTURAS_NOTICIAS aponta para uma pasta");
    await entrar(page);
    for (const [largura, altura] of [[390, 844], [1280, 900]] as const) {
      for (const tema of ["light", "dark"] as const) {
        await page.setViewportSize({ width: largura, height: altura });
        await page.emulateMedia({ colorScheme: tema });
        await page.goto("/noticias");
        await expect(page.locator("article", { hasText: TITULO_COM_FOTO }).locator("img")).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${pasta}/noticias-${largura}-${tema === "light" ? "claro" : "escuro"}.png`, fullPage: true });
      }
    }
  });
});
