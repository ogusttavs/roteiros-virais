/**
 * Revisão do Fable no PR #100 (R2b): cinco ajustes de tela, achados por captura própria a 390,
 * 1024 e 1280. Guarda a prova automatizada de cada um; as capturas próprias ficam em
 * `.revisao/fotos-pr100/` (fora do repositório, mesmo lugar das rodadas anteriores).
 *
 * 1 e 2. A folha "Por que esse funcionou": a moldura do vídeo empurrava tudo para fora da tela a
 *    1024/1280 (sem o teto de largura/altura que `FolhaDetalhesVideo.module.css` agora dá); a 390,
 *    o nome da conta some e o rótulo da rede ficava solto no meio da moldura (bug de posição por
 *    grade do CSS, corrigido para `position: absolute`).
 * 3. "De onde veio" no roteiro: a miniatura de 9rem era pequena demais; agora o vídeo usa a
 *    largura do cartão (`CartaoDeOndeVeio.module.css`).
 * 4. Os filtros ativos ganham fichas removíveis com X, mais "Tirar os filtros".
 * 5. O segmento "Todos" tem o próprio subtítulo, no lugar do de "Fora da curva".
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
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
const EMAIL = "e2e-r2b-revisao@exemplo.teste";
const SLUG_NICHO = "e2e-r2b-revisao-nicho";
const PASTA_CAPTURAS = path.join(__dirname, "..", "..", ".revisao", "fotos-pr100");
/** Capa 9:16 por URI de dados (design v2 usa a mesma técnica nos mocks): sem depender de rede nenhuma. */
const CAPA =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 90 160'%3E%3Crect width='90' height='160' fill='%236f6757'/%3E%3C/svg%3E";

mkdirSync(PASTA_CAPTURAS, { recursive: true });

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

function analiseExemplo(assunto: string) {
  return {
    assunto,
    gancho: "Abre com a mão já esfregando a mancha, sem falar por dois segundos.",
    estrutura: "Aplica o produto sem cortar o vídeo, falando o tempo de espera em voz alta.",
    fechamento: "Resumo do antes e depois.",
    chamadaFinal: "Comenta se você já passou por isso.",
    formato: "fala_para_camera" as const,
    porQueFuncionou: "A pessoa vê o problema dela na tela nos dois primeiros segundos e fica para ver o certo.",
  };
}

test.describe("/referencias e /roteiros, revisão do Fable no PR #100", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-r2b-revisao"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: SLUG_NICHO, nome: "[teste] Revisão PR 100", termos: [] }).returning();
    const [conta] = await db()
      .insert(contas)
      .values({
        plataforma: "youtube",
        handle: "@e2e-r2b-revisao",
        nome: "Casa Limpa e Organizada",
        nichoId: nicho.id,
        medianaViews: "5035",
        medianaOrigem: "conta",
      })
      .returning();

    await db().insert(user).values({ id: "e2e-r2b-revisao", name: "[teste] Revisão PR 100", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-r2b-revisao-credential",
        issuer: "local:credential",
        accountId: "e2e-r2b-revisao",
        providerId: "credential",
        userId: "e2e-r2b-revisao",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-r2b-revisao", aceitouTermosEm: new Date() });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-r2b-revisao", nome: "[teste] Revisão PR 100", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-r2b-revisao", clienteId: cliente.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });

    // Vídeo real do YouTube ("Me at the zoo", o primeiro do site, estável e sempre no ar), com
    // capa, para a folha "Por que esse funcionou" e para "De onde veio" no roteiro.
    const [videoYoutube] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-r2b-revisao-youtube",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        nichoId: nicho.id,
        contaId: conta.id,
        titulo: "a mancha que volta: o erro está na ordem, não no produto",
        views: 128_400,
        foraDaCurva: "25.5",
        velocidade: "4120",
        idioma: "pt",
        capaUrl: CAPA,
        publicadoEm: new Date(),
        analise: analiseExemplo("mancha em estofado") as never,
        analiseVisual: { momentoChave: { segundo: 4, oQueMostra: "o gancho" } } as never,
      })
      .returning();

    // Endereço real do Instagram (código que não existe: o teste intercepta e confere só o
    // endereço do iframe, mesma técnica de video-embed-r2a.spec.ts).
    await db()
      .insert(videos)
      .values({
        plataforma: "instagram",
        idExterno: "e2e-r2b-revisao-instagram",
        url: "https://www.instagram.com/p/e2e-r2b-revisao/",
        nichoId: nicho.id,
        contaId: conta.id,
        titulo: "o pano certo para cada tecido, em 30 segundos",
        views: 61_300,
        foraDaCurva: "6.7",
        idioma: "pt",
        capaUrl: CAPA,
        publicadoEm: new Date(),
        analise: analiseExemplo("pano por tecido") as never,
      });

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
      edicao: {
        textoNaTela: [],
        ritmoDeCorte: "moderado",
        recursos: [],
        audio: null,
        referencia: { videoId: videoYoutube.id, segundo: 4, oQueOlhar: "o gancho" },
      },
      evidencias: [videoYoutube.id],
      semEvidencia: false,
      forcaEvidencia: "media",
    };
    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: "2026-01-01",
        tema: conteudo.titulo,
        origem: "sugerido",
        objetivo: "conversao",
        conteudo,
        referenciaVideoId: videoYoutube.id,
      })
      .returning();
  });

  test("itens 1 e 2: a folha 'Por que esse funcionou' cabe na tela a 1024 e 1280, sem empurrar a conta e os números para fora", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto("/referencias?periodo=90");

    const cartao = page.locator("article", { hasText: "a mancha que volta" });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();

    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(folha).toBeVisible();

    // Item 1, teste de medida: a 1280, a conta e o bloco dos números ficam dentro da janela, sem
    // precisar rolar a folha (ela abre com o topo do corpo visível, scrollTop 0).
    const conta = folha.getByText("Casa Limpa e Organizada", { exact: true });
    const numeros = folha.getByText(/views, contra um normal de/);
    await expect(conta).toBeVisible();
    await expect(numeros).toBeVisible();
    const alturaJanela = (await page.viewportSize())!.height;
    const caixaConta = await conta.boundingBox();
    const caixaNumeros = await numeros.boundingBox();
    expect(caixaConta).not.toBeNull();
    expect(caixaNumeros).not.toBeNull();
    expect(caixaConta!.y + caixaConta!.height).toBeLessThanOrEqual(alturaJanela);
    expect(caixaNumeros!.y + caixaNumeros!.height).toBeLessThanOrEqual(alturaJanela);

    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "folha-detalhes-1280.png") });

    await page.setViewportSize({ width: 1024, height: 850 });
    await expect(conta).toBeVisible();
    await expect(numeros).toBeVisible();
    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "folha-detalhes-1024.png") });
  });

  test("item 2: a 390, o nome da conta aparece logo abaixo do vídeo, e o rótulo da rede fica no canto da moldura, não solto no meio", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/referencias?periodo=90");

    const cartao = page.locator("article", { hasText: "a mancha que volta" });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();

    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(folha).toBeVisible();
    await expect(folha.getByText("Casa Limpa e Organizada", { exact: true })).toBeVisible();

    const botaoTocar = folha.getByRole("button", { name: /^Tocar / });
    await expect(botaoTocar).toBeVisible();
    const caixaMoldura = (await botaoTocar.boundingBox())!;
    const redePrevia = folha.getByText("YouTube", { exact: true });
    const caixaRede = (await redePrevia.boundingBox())!;
    // O rótulo da rede fica no canto superior esquerdo da moldura (não solto no meio): a distância
    // até o topo da moldura é pequena (perto do padding do canto), bem menor que a metade da altura.
    expect(caixaRede.y - caixaMoldura.y).toBeLessThan(caixaMoldura.height * 0.25);

    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "folha-detalhes-390.png") });
  });

  test("item 3: 'De onde veio' no roteiro usa a largura do cartão (pelo menos 240px a 390 e a 1280)", async ({ page }) => {
    const [cliente] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-r2b-revisao"));
    const [roteiro] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.clienteId, cliente.id));

    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto(`/roteiros/${roteiro.id}`);

    const secao = page.locator("section", { hasText: "Referência" });
    const botaoTocar390 = secao.getByRole("button", { name: /^Tocar / });
    await expect(botaoTocar390).toBeVisible();
    const caixa390 = (await botaoTocar390.boundingBox())!;
    expect(caixa390.width).toBeGreaterThanOrEqual(240);
    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "de-onde-veio-390.png") });

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(botaoTocar390).toBeVisible();
    const caixa1280 = (await botaoTocar390.boundingBox())!;
    expect(caixa1280.width).toBeGreaterThanOrEqual(240);
    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "de-onde-veio-1280.png") });
  });

  test("item 4: filtros ativos viram fichas removíveis, com X e 'Tirar os filtros', a 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/referencias?periodo=90&plataforma=youtube");

    const fichas = page.getByLabel("Filtros ligados");
    await expect(fichas).toBeVisible();
    await expect(fichas.getByRole("button", { name: /^Tirar o filtro YouTube/ })).toBeVisible();
    await expect(fichas.getByRole("button", { name: "Tirar os filtros" })).toBeVisible();
    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "fichas-390.png") });

    await fichas.getByRole("button", { name: "Tirar os filtros" }).click();
    await expect(page).not.toHaveURL(/plataforma=youtube/);
    await expect(fichas).toBeHidden();
  });

  /**
   * Passo 14 (etapa posterior a este PR): a partir de 1024px as pílulas de filtro à vista
   * substituem as fichas, que o item 4 original media aqui; a pílula mostra o próprio estado
   * ativo, sem ficha nenhuma. Cobertura própria em `referencias-pilulas.spec.ts`.
   */
  test("item 4, a 1280: as fichas somem, a pílula mostra o estado ativo no lugar delas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto("/referencias?periodo=90&plataforma=youtube");

    await expect(page.getByLabel("Filtros ligados")).toBeHidden();
    await expect(page.getByRole("button", { name: "YouTube" })).toBeVisible();
    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "fichas-1280.png") });

    await page.getByRole("button", { name: "YouTube" }).click();
    await page.getByRole("menuitemcheckbox", { name: "YouTube" }).click();
    await expect(page).not.toHaveURL(/plataforma=youtube/);
  });

  test("item 5: o segmento Todos mostra o próprio subtítulo, não o de Fora da curva", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto("/referencias?seg=todos&periodo=90");

    await expect(page.getByText("Tudo o que a gente analisou no seu setor", { exact: false })).toBeVisible();
    await expect(page.getByText("Vídeos que passaram muito do normal da própria conta", { exact: false })).toHaveCount(0);
    await page.screenshot({ path: path.join(PASTA_CAPTURAS, "todos-subtitulo-1280.png") });
  });
});
