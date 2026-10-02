/**
 * R2b, itens 1 a 3 (`PROXIMO.md`): o segmento "Todos" (todo vídeo do setor com análise, sem o
 * corte do piso nem do múltiplo), os selos de "abaixo do que a gente usa como prova" e de tipo
 * (meme/recorte), o filtro combinado de "Tipo de vídeo", "Ver mais" crescendo a quantidade sem
 * offset, e o hotfix da vírgula solta em "Filtrar , 2" (virou um número só, sem vírgula).
 *
 * Roteiro próprio ("e2e-r2b"), nicho isolado (mesma lição de `roteiro.spec.ts`/`referencias.spec.ts`:
 * um conjunto de vídeos só deste arquivo, para não disputar contagem com o resto da suíte nem com os
 * dados de `referencias.spec.ts`).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contas, membrosMarca, nichos, preferenciasUsuario, user, videos } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-r2b@exemplo.teste";
const SLUG_NICHO = "e2e-r2b-nicho";
/** Mesmo valor de `TAMANHO_PAGINA_TODOS_PADRAO` (`src/servicos/pesquisa.ts`): não importado aqui de propósito, o e2e prova o comportamento visível, não o número interno. */
const TAMANHO_PAGINA = 30;

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
    gancho: "gancho",
    estrutura: "estrutura",
    fechamento: "fechamento",
    chamadaFinal: "chamada",
    formato: "fala_para_camera" as const,
    porQueFuncionou: "x",
  };
}

test.describe("/referencias, R2b: o segmento Todos, os filtros e Ver mais", () => {
  test.beforeAll(async () => {
    // Mesma proteção contra o retry automático do Playwright já usada em `referencias.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-r2b"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: SLUG_NICHO, nome: "[teste] R2b", termos: [] }).returning();
    const [conta] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "@e2e-r2b", nome: "[teste] Conta R2b", nichoId: nicho.id })
      .returning();

    await db().insert(user).values({ id: "e2e-r2b", name: "[teste] R2b", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-r2b-credential",
        issuer: "local:credential",
        accountId: "e2e-r2b",
        providerId: "credential",
        userId: "e2e-r2b",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-r2b", aceitouTermosEm: new Date() });
    const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-r2b", nome: "[teste] R2b", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-r2b", clienteId: cliente.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });

    // Dois "Fora da curva" de verdade: entram nos dois segmentos.
    await db()
      .insert(videos)
      .values([
        {
          plataforma: "tiktok",
          idExterno: "e2e-r2b-fdc-1",
          url: "https://exemplo.invalido/e2e-r2b-fdc-1",
          nichoId: nicho.id,
          contaId: conta.id,
          titulo: "fora da curva um",
          views: 60_000,
          foraDaCurva: "5.0",
          idioma: "pt",
          // Um minuto à frente de "agora" (proposital): garante que estes quatro vídeos fixos
          // sempre ficam entre os mais recentes, nunca empurrados para a segunda página pelos
          // TAMANHO_PAGINA + 1 vídeos de paginação, inseridos logo depois.
          publicadoEm: new Date(Date.now() + 60_000),
          analise: analiseExemplo("video fora da curva um") as never,
        },
        {
          plataforma: "tiktok",
          idExterno: "e2e-r2b-fdc-2",
          url: "https://exemplo.invalido/e2e-r2b-fdc-2",
          nichoId: nicho.id,
          contaId: conta.id,
          titulo: "fora da curva dois",
          views: 60_000,
          foraDaCurva: "5.0",
          idioma: "pt",
          publicadoEm: new Date(Date.now() + 60_000),
          analise: analiseExemplo("video fora da curva dois") as never,
        },
        // Um meme: só aparece em "Todos", com o selo do tipo.
        {
          plataforma: "tiktok",
          idExterno: "e2e-r2b-meme",
          url: "https://exemplo.invalido/e2e-r2b-meme",
          nichoId: nicho.id,
          contaId: conta.id,
          titulo: "video que e um meme",
          views: 60_000,
          foraDaCurva: "5.0",
          idioma: "pt",
          serveDeModelo: false,
          tipoConteudo: "meme",
          publicadoEm: new Date(Date.now() + 60_000),
          analise: analiseExemplo("video meme") as never,
        },
        // Abaixo do múltiplo (régua de 1,5x): só aparece em "Todos", com o selo "abaixo da régua".
        {
          plataforma: "tiktok",
          idExterno: "e2e-r2b-abaixo-regua",
          url: "https://exemplo.invalido/e2e-r2b-abaixo-regua",
          nichoId: nicho.id,
          contaId: conta.id,
          titulo: "video abaixo da regua",
          views: 60_000,
          foraDaCurva: "1.1",
          idioma: "pt",
          publicadoEm: new Date(Date.now() + 60_000),
          analise: analiseExemplo("video abaixo da regua") as never,
        },
      ]);

    // TAMANHO_PAGINA + 1 vídeos "fora da curva" de verdade, só para o "Ver mais" ter o que mostrar
    // (o "Todos" conta junto com os 4 de cima: total = TAMANHO_PAGINA + 1 + 4).
    const videosParaPaginar = Array.from({ length: TAMANHO_PAGINA + 1 }, (_valor, indice) => ({
      plataforma: "tiktok" as const,
      idExterno: `e2e-r2b-pagina-${indice}`,
      url: `https://exemplo.invalido/e2e-r2b-pagina-${indice}`,
      nichoId: nicho.id,
      contaId: conta.id,
      titulo: `video de paginacao ${indice}`,
      views: 60_000,
      foraDaCurva: "5.0",
      idioma: "pt",
      publicadoEm: new Date(Date.now() - indice * 1000),
      analise: analiseExemplo(`video de paginacao ${indice}`) as never,
    }));
    await db().insert(videos).values(videosParaPaginar);
  });

  test("o segmento Todos mostra meme e abaixo da régua, com os selos; Fora da curva não mostra nenhum dos dois", async ({ page }) => {
    await entrar(page);
    await page.goto(`/referencias?periodo=90`);

    await expect(page.locator("article", { hasText: "fora da curva um" })).toBeVisible();
    await expect(page.locator("article", { hasText: "video que e um meme" })).toHaveCount(0);
    await expect(page.locator("article", { hasText: "video abaixo da regua" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Todos" }).click();
    await expect(page).toHaveURL(/seg=todos/);

    const cartaoMeme = page.locator("article", { hasText: "video que e um meme" });
    await expect(cartaoMeme).toBeVisible();
    await expect(cartaoMeme.getByText("meme", { exact: true })).toBeVisible();

    const cartaoAbaixoRegua = page.locator("article", { hasText: "video abaixo da regua" });
    await expect(cartaoAbaixoRegua).toBeVisible();
    await expect(cartaoAbaixoRegua.getByText("abaixo do que a gente usa como prova")).toBeVisible();
  });

  test("Ver mais cresce a lista sem offset, até não sobrar mais nada para mostrar", async ({ page }) => {
    await entrar(page);
    await page.goto("/referencias?seg=todos&periodo=90");

    const cartoes = page.locator("article");
    await expect(cartoes).toHaveCount(TAMANHO_PAGINA);
    const botaoVerMais = page.getByRole("button", { name: "Ver mais" });
    await expect(botaoVerMais).toBeVisible();

    await botaoVerMais.click();
    // Os 4 fixos (fora da curva x2, meme, abaixo da régua) mais os TAMANHO_PAGINA + 1 de paginação.
    await expect(cartoes).toHaveCount(TAMANHO_PAGINA + 1 + 4, { timeout: 10_000 });
    await expect(botaoVerMais).toHaveCount(0);
  });

  test("o filtro de Tipo de vídeo (meme) reduz a lista em Todos, e o botão Filtrar mostra só o número, sem vírgula", async ({
    page,
  }) => {
    // Abaixo de 1024px: a partir dali o botão "Filtrar" vira as pílulas (passo 14).
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/referencias?seg=todos&periodo=90");

    await page.getByRole("button", { name: "Filtrar", exact: false }).click();
    const folha = page.getByRole("dialog", { name: "Filtrar" });
    await expect(folha).toBeVisible();

    // Nome acessível do botão: "meme" seguido da contagem ("meme 1"), nunca "meme" sozinho.
    await folha.getByRole("button", { name: /^meme\b/ }).click();
    await folha.getByRole("button", { name: /Ver os \d+ vídeos?/ }).click();
    await expect(folha).not.toBeVisible();

    await expect(page).toHaveURL(/tipo=meme/);
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article", { hasText: "video que e um meme" })).toBeVisible();

    const botaoFiltrar = page.getByRole("button", { name: "Filtrar", exact: false });
    await expect(botaoFiltrar).toBeVisible();
    const textoBotao = await botaoFiltrar.innerText();
    // O número aparece (um filtro ligado), mas nunca mais com a vírgula solta (hotfix do passo 14).
    expect(textoBotao).toContain("1");
    expect(textoBotao).not.toContain(",");
  });
});
