/**
 * Hotfix de 22/10/2026, a capa do Instagram que vencia (achado do Gustavo em produção): a Referência aparecia como um quadro preto só com o play, porque `videos.capa_url` é um link assinado
 * do CDN da Meta e vence em dias (403). Prova, na tela do roteiro e em Referências, os três casos: a capa que o CDN recusa (403) troca na hora pelo embed oficial do Instagram, sem quadro
 * preto; a capa marcada vencida no banco monta o embed sem nem pedir ao CDN; a capa guardada do nosso lado abre pela rota `/api/capa/<id>`. Na lista de Referências o cartão nunca monta
 * embed (pesaria no celular): escreve a rede e oferece "Ver no Instagram". O CDN e o instagram.com são interceptados: nada sai para a rede de verdade.
 *
 * `CAPTURAR_CAPAS=1` grava as capturas a 390 e 1280, nos dois temas, em `entregaveis/design/capturas/capas/`.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  capasVideo,
  clientes,
  contas,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  user,
  videos,
  type ConteudoRoteiro,
} from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const ID = "e2e-capa-vencida";
const EMAIL = `${ID}@exemplo.teste`;
const CDN = "https://scontent-gru2-1.cdninstagram.com/v/t51/capa-vencida.jpg?oe=abc&sig=123";
/** Um PNG de 1 pixel, de verdade: a rota entrega estes bytes e o navegador os desenha. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const CAPTURAR = process.env.CAPTURAR_CAPAS === "1";
const PASTA_CAPTURAS = path.join(__dirname, "..", "..", "..", "..", "..", "entregaveis", "design", "capturas", "capas");

if (CAPTURAR) mkdirSync(PASTA_CAPTURAS, { recursive: true });

let clienteId: number;
let nichoId: number;
let contaId: number;
let diaSeguinte = 0;

const analise = {
  assunto: "capa vencida",
  gancho: "gancho",
  estrutura: "estrutura",
  fechamento: "fechamento",
  chamadaFinal: "chamada",
  formato: "fala_para_camera" as const,
  porQueFuncionou: "todo mundo se reconhece no erro e fica para ver o certo",
};

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** O CDN da Meta recusa (403) e o instagram.com devolve uma página qualquer; conta quantos pedidos foram ao CDN. */
async function interceptar(page: Page): Promise<{ aoCdn: () => number }> {
  let aoCdn = 0;
  await page.route("**://scontent-gru2-1.cdninstagram.com/**", (rota) => {
    aoCdn += 1;
    return rota.fulfill({ status: 403, body: "" });
  });
  await page.route("**://www.instagram.com/**", (rota) => rota.fulfill({ status: 200, contentType: "text/html", body: "<p>incorporado</p>" }));
  return { aoCdn: () => aoCdn };
}

async function criarReel(chave: string, capaUrl: string | null): Promise<number> {
  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "instagram",
      idExterno: `${ID}-${chave}`,
      url: `https://www.instagram.com/reel/${ID}${chave}/`,
      nichoId,
      contaId,
      titulo: `reel ${chave} da capa vencida`,
      views: 60_000,
      foraDaCurva: "20.0",
      idioma: "pt",
      capaUrl,
      publicadoEm: new Date(),
      analise: analise as never,
    })
    .returning();
  return video.id;
}

async function criarRoteiro(videoId: number): Promise<number> {
  const conteudo: ConteudoRoteiro = {
    titulo: "a mancha que volta: o erro está na ordem, não no produto",
    duracaoS: 30,
    gancho: "gancho de teste",
    corpo: "corpo de teste",
    fechamento: "fechamento de teste",
    chamadaFinal: "chamada final de teste",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "na sala",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: { videoId, segundo: 4, oQueOlhar: "o gancho" } },
    evidencias: [videoId],
    semEvidencia: false,
    forcaEvidencia: "media",
  };
  diaSeguinte += 1;
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: `2026-02-${String(diaSeguinte).padStart(2, "0")}`,
      tema: conteudo.titulo,
      origem: "sugerido",
      objetivo: "conversao",
      conteudo,
      referenciaVideoId: videoId,
    })
    .returning();
  return roteiro.id;
}

async function capturar(page: Page, nome: string, alvo: Locator) {
  if (!CAPTURAR) return;
  for (const [largura, altura] of [
    [390, 844],
    [1280, 900],
  ] as const) {
    for (const tema of ["light", "dark"] as const) {
      await page.setViewportSize({ width: largura, height: altura });
      await page.emulateMedia({ colorScheme: tema });
      await alvo.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(PASTA_CAPTURAS, `${nome}-${largura}-${tema}.png`) });
    }
  }
}

test.beforeAll(async () => {
  await db().delete(user).where(eq(user.id, ID));
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
  nichoId = nicho.id;
  await db().insert(user).values({ id: ID, name: "[teste] capa vencida", email: EMAIL });
  await db().insert(account).values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
  const [cliente] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] capa vencida", nichoId }).returning();
  clienteId = cliente.id;
  await db().insert(membrosMarca).values({ usuarioId: ID, clienteId, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
  await db().insert(briefings).values({ clienteId, completo: true });
  const [conta] = await db().insert(contas).values({ plataforma: "instagram", handle: `@${ID}`, nome: "Casa em Ordem", nichoId }).returning();
  contaId = conta.id;
});

test.describe("a capa do Instagram que vence", () => {
  test("roteiro: a capa que o CDN recusa (403) troca na hora pelo embed do Instagram, sem quadro preto nem play vazio", async ({ page }) => {
    const videoId = await criarReel("recusada", CDN);
    const roteiroId = await criarRoteiro(videoId);
    await interceptar(page);
    await entrar(page);
    await page.goto(`/roteiros/${roteiroId}`);

    const secao = page.locator("section", { hasText: "Referência" });
    await expect(secao.locator("iframe")).toHaveAttribute("src", `https://www.instagram.com/reel/${ID}recusada/embed`, { timeout: 15_000 });
    await expect(secao.getByRole("button", { name: /^Tocar / })).toHaveCount(0);
    await expect(secao.locator("img")).toHaveCount(0);
    await capturar(page, "roteiro-capa-recusada", secao);
  });

  test("roteiro: a capa marcada vencida monta o embed sem nem pedir a imagem ao CDN", async ({ page }) => {
    const videoId = await criarReel("vencida", CDN);
    await db().insert(capasVideo).values({ videoId, situacao: "vencida", urlTentada: CDN, tentativas: 1 });
    const roteiroId = await criarRoteiro(videoId);
    const cdn = await interceptar(page);
    await entrar(page);
    await page.goto(`/roteiros/${roteiroId}`);

    const secao = page.locator("section", { hasText: "Referência" });
    await expect(secao.locator("iframe")).toHaveAttribute("src", `https://www.instagram.com/reel/${ID}vencida/embed`, { timeout: 15_000 });
    await expect(secao.getByRole("button", { name: /^Tocar / })).toHaveCount(0);
    expect(cdn.aoCdn()).toBe(0);
  });

  test("roteiro: a capa guardada do nosso lado abre pela rota, com o play, e nunca vai ao CDN", async ({ page }) => {
    const videoId = await criarReel("guardada", CDN);
    await db().insert(capasVideo).values({ videoId, situacao: "guardada", tipo: "image/png", bytes: PNG, urlTentada: CDN });
    const roteiroId = await criarRoteiro(videoId);
    const cdn = await interceptar(page);
    await entrar(page);
    await page.goto(`/roteiros/${roteiroId}`);

    const secao = page.locator("section", { hasText: "Referência" });
    await expect(secao.getByRole("button", { name: /^Tocar / })).toBeVisible();
    const imagem = secao.locator("img");
    await expect(imagem).toHaveAttribute("src", `/api/capa/${videoId}`);
    await expect.poll(() => imagem.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(secao.locator("iframe")).toHaveCount(0);
    expect(cdn.aoCdn()).toBe(0);
    await capturar(page, "roteiro-capa-guardada", secao);

    // A rota é só para quem está logado: sem o cookie, o middleware manda para a entrada.
    const semSessao = await page.context().browser()!.newContext();
    const resposta = await semSessao.request.get(new URL(`/api/capa/${videoId}`, page.url()).toString(), { maxRedirects: 0 });
    expect([302, 307, 401]).toContain(resposta.status());
    expect(resposta.headers()["content-type"] ?? "").not.toContain("image/");
    await semSessao.close();
  });

  test("Referências: o cartão sem capa escreve a rede e oferece 'Ver no Instagram', e a lista nunca monta um embed", async ({ page }) => {
    const videoId = await criarReel("lista", CDN);
    await db().insert(capasVideo).values({ videoId, situacao: "vencida", urlTentada: CDN, tentativas: 1 });
    await interceptar(page);
    await entrar(page);
    await page.goto("/referencias?periodo=90");

    const cartao = page.locator("article", { hasText: `reel lista da capa vencida` });
    await expect(cartao.getByText("Casa em Ordem")).toBeVisible();
    await expect(cartao.getByText("Instagram, ", { exact: false }).first()).toBeVisible();
    const link = cartao.getByRole("link", { name: "Ver no Instagram" });
    await expect(link).toHaveAttribute("href", `https://www.instagram.com/reel/${ID}lista/`);
    await expect(cartao.locator("img")).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);
    await capturar(page, "referencias-capa-vencida", cartao);

    // Na folha de um vídeo só (a tela de um vídeo), o embed entra na hora.
    await page.setViewportSize({ width: 390, height: 844 });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();
    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(folha.locator("iframe")).toHaveAttribute("src", `https://www.instagram.com/reel/${ID}lista/embed`, { timeout: 15_000 });
  });
});
