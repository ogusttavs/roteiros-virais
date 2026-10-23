/**
 * Defeito de 23/10/2026 (iPhone, Safari com a barra de endereço à vista, Criar rolada até o fim): a cápsula de abas, na forma encolhida (só os ícones), ficou parada no meio da tela, por
 * cima do conteúdo. Mesma família do hotfix de 06/10 (#139, barra de ações e cápsula no meio da tela no iPhone instalado). A causa lida no código está em `layout.module.css`
 * (`.barraInferior`): o elemento `position: fixed` tinha o `transform: translateX(-50%)` do centramento, o `backdrop-filter` e a transição de `width` ao encolher; o desenho agora
 * tem a ancoragem fixa sem nada que mexa na geometria e a cápsula dentro dela.
 *
 * O que o Chromium prova aqui: depois de rolar até o fim (a cápsula encolhe), de subir e descer de novo, e de encolher e devolver a janela (a barra do Safari que aparece e some),
 * o retângulo da cápsula termina colado no rodapé e centrado; e o elemento fixo não tem `transform` nem `backdrop-filter` (para ninguém trazer de volta o que o WebKit perde). O que o
 * Chromium NÃO prova: a camada do WebKit no iPhone; essa prova é do aparelho do Gustavo (ver o PR). De 768 para cima a cápsula não existe (a barra lateral toma o lugar): nesse
 * tamanho o teste confere que ela continua sumida e que a barra lateral fica à vista depois de rolar.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-capsula-rodape@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Rola em passos curtos, como o dedo: a regra da cápsula soma a descida de vários eventos de rolagem, não de um salto só. */
async function rolarEm(page: Page, de: number, ate: number, passo: number) {
  const sentido = ate >= de ? 1 : -1;
  for (let y = de; sentido * (ate - y) > 0; y += sentido * passo) {
    await page.evaluate((alvo) => window.scrollTo(0, alvo), y);
    await page.waitForTimeout(25);
  }
  await page.evaluate((alvo) => window.scrollTo(0, alvo), ate);
  await page.waitForTimeout(60);
}

/** Uma tela de rolagem comprida de verdade: o corpo da tela ganha altura, sem mudar nada do que a cápsula faz. */
async function alongarATela(page: Page) {
  await page.evaluate(() => {
    const corpo = document.querySelector("main");
    if (corpo) (corpo as HTMLElement).style.minHeight = "3600px";
  });
}

test.describe("a cápsula de abas fica no rodapé depois de rolar até o fim", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-capsula-rodape"));
    if (existente) return;
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
    await db().insert(user).values({ id: "e2e-capsula-rodape", name: "[teste] Cápsula no rodapé", email: EMAIL });
    await db().insert(account).values({ id: "e2e-capsula-rodape-credential", issuer: "local:credential", accountId: "e2e-capsula-rodape", providerId: "credential", userId: "e2e-capsula-rodape", password: await hashPassword(SENHA) });
    const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-capsula-rodape", nome: "[teste] Cápsula no rodapé", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-capsula-rodape", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-capsula-rodape", aceitouTermosEm: new Date() });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
  });

  test.describe("iPhone, 390x844", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    /** O retângulo da cápsula (o vidro, não a faixa de ancoragem), e a altura da janela de agora. */
    async function medir(page: Page) {
      const caixa = await page.locator("[data-capsula-abas] > div").boundingBox();
      if (!caixa) throw new Error("cápsula sem caixa delimitadora");
      const janela = await page.evaluate(() => ({ altura: window.innerHeight, largura: window.innerWidth }));
      return { ...caixa, folgaBaixo: janela.altura - (caixa.y + caixa.height), centro: caixa.x + caixa.width / 2, larguraJanela: janela.largura };
    }

    function colada(m: Awaited<ReturnType<typeof medir>>) {
      // 8 px de respiro (`--espaco-2`) mais a área segura de baixo, que o Chromium emula como 0: nunca mais que 24 px do rodapé, e nunca abaixo dele.
      expect(m.folgaBaixo).toBeGreaterThanOrEqual(0);
      expect(m.folgaBaixo).toBeLessThanOrEqual(24);
      expect(Math.abs(m.centro - m.larguraJanela / 2)).toBeLessThan(1);
    }

    test("rolar até o fim encolhe a cápsula e ela termina no rodapé; subir e descer, e a barra do Safari indo e vindo, não a soltam", async ({ page }) => {
      await entrar(page);
      await page.goto("/criar");
      await page.waitForLoadState("networkidle");
      await alongarATela(page);

      const antes = await medir(page);
      colada(antes);
      expect(antes.width).toBeGreaterThan(300); // cheia, com os rótulos

      // A estrutura que o WebKit perde: o elemento fixo não carrega `transform` nem `backdrop-filter` (ficam na cápsula dentro dele).
      const ancora = await page.locator("[data-capsula-abas]").evaluate((el) => {
        const css = getComputedStyle(el);
        return { posicao: css.position, transform: css.transform, desfoque: css.backdropFilter || "none" };
      });
      expect(ancora).toEqual({ posicao: "fixed", transform: "none", desfoque: "none" });

      // Até o fim da página, em passos: a cápsula encolhe (só os ícones) e fica no rodapé.
      const fim = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(fim).toBeGreaterThan(1000);
      await rolarEm(page, 0, fim, 60);
      await expect.poll(async () => (await medir(page)).width, { timeout: 5000 }).toBeLessThan(260);
      await page.waitForTimeout(500); // a mola da largura (300 ms) assentou
      colada(await medir(page));
      await expect(page.locator("[data-capsula-abas] a").first()).toBeVisible();

      // A barra de endereço do Safari aparece e some (a altura da janela muda) com a página no fim: a cápsula acompanha o rodapé de cada altura.
      await page.setViewportSize({ width: 390, height: 730 });
      colada(await medir(page));
      await page.setViewportSize({ width: 390, height: 844 });
      colada(await medir(page));

      // Subir de propósito abre a cápsula; descer de novo a encolhe; nos dois casos ela fica no rodapé.
      await rolarEm(page, fim, Math.max(fim - 600, 0), 60);
      await expect.poll(async () => (await medir(page)).width, { timeout: 5000 }).toBeGreaterThan(300);
      await page.waitForTimeout(500);
      colada(await medir(page));
      await rolarEm(page, Math.max(fim - 600, 0), fim, 60);
      await expect.poll(async () => (await medir(page)).width, { timeout: 5000 }).toBeLessThan(260);
      await page.waitForTimeout(500);
      colada(await medir(page));
    });
  });

  /**
   * O topo (achados do Gustavo no iPhone, 23/10/2026, 08:42). (1) Planejar tinha duas barras no topo: a do cabeçalho genérico (o nome do produto) por baixo da `BarraTopo` da tela (o título), e as
   * duas se liam uma por cima da outra. Cada tela tem UMA barra de topo. (2) A cor da faixa do sistema (`theme-color`) é a do fundo do topo, nos dois temas, e a rolagem nunca a troca (a causa
   * provável do hotfix #139 de 06/10).
   */
  test.describe("o topo no iPhone, 390x844", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    function paraHex(rgb: string): string {
      const partes = rgb.match(/[\d.]+/g) ?? [];
      return `#${partes.slice(0, 3).map((c) => Math.round(Number(c)).toString(16).padStart(2, "0")).join("")}`;
    }

    test("cada tela tem uma barra de topo só: Planejar não mostra o nome do produto por baixo do título, nem a rolagem os junta", async ({ page }) => {
      await entrar(page);
      for (const rota of ["/planejamento", "/criar", "/hoje"]) {
        await page.goto(rota);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("[data-barra-topo]"), `${rota}: uma barra de topo só`).toHaveCount(1);
      }
      await page.goto("/planejamento");
      await page.waitForLoadState("networkidle");
      const barra = page.locator("[data-barra-topo]");
      await expect(barra).toContainText("Planejar");
      // Um par de botões só (o do cabeçalho genérico empilhado desenhava dois "Atualizar").
      expect(await page.getByRole("button", { name: "Atualizar" }).count()).toBe(1);
      await alongarATela(page);
      await rolarEm(page, 0, 300, 60);
      await expect(page.locator("[data-barra-topo]")).toHaveCount(1);

      // As telas que ainda usam o cabeçalho genérico continuam com uma barra só, e com o nome do produto.
      await page.goto("/referencias");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("[data-barra-topo]")).toHaveCount(1);
    });

    for (const esquema of ["light", "dark"] as const) {
      test(`a theme-color é a cor do fundo do topo (${esquema}) e a rolagem não a troca`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: esquema });
        await entrar(page);
        await page.goto("/planejamento");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(800); // o efeito mede de novo 400 ms depois da tela entrar

        const medidas = () =>
          page.evaluate(() => ({
            fundo: getComputedStyle(document.body).backgroundColor,
            fundoHtml: getComputedStyle(document.documentElement).backgroundColor,
            metas: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute("content") ?? ""),
          }));
        const antes = await medidas();
        const hex = paraHex(antes.fundo);
        expect(hex).toBe(esquema === "light" ? "#f7f7f5" : "#050506");
        expect(paraHex(antes.fundoHtml)).toBe(hex); // o fundo vai até a borda: também no <html>
        expect(antes.metas.length).toBeGreaterThan(0);
        for (const meta of antes.metas) expect(meta.toLowerCase()).toBe(hex);

        // Rolar (a barra de cima vira vidro) não mexe nas metas: a cor é medida na entrada da tela e nunca durante a rolagem.
        await page.evaluate(() => {
          (window as unknown as { __trocas: number }).__trocas = 0;
          new MutationObserver((registros) => {
            (window as unknown as { __trocas: number }).__trocas += registros.length;
          }).observe(document.head, { attributes: true, childList: true, subtree: true });
        });
        await alongarATela(page);
        await rolarEm(page, 0, 600, 40);
        await rolarEm(page, 600, 0, 40);
        const trocas = await page.evaluate(() => (window as unknown as { __trocas: number }).__trocas);
        expect(trocas).toBe(0);
        expect((await medidas()).metas).toEqual(antes.metas);
      });
    }
  });

  test.describe("iPad, 834x1194", () => {
    test.use({ viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test("do tablet para cima a cápsula não existe, e a barra lateral fica à vista depois de rolar até o fim", async ({ page }) => {
      await entrar(page);
      await page.goto("/criar");
      await page.waitForLoadState("networkidle");
      await alongarATela(page);

      await expect(page.locator("[data-capsula-abas]")).toBeHidden();
      const lateral = page.locator("aside nav").first();
      await expect(lateral).toBeInViewport();

      const fim = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(fim).toBeGreaterThan(1000);
      await rolarEm(page, 0, fim, 120);
      await expect(page.locator("[data-capsula-abas]")).toBeHidden();
      await expect(lateral).toBeInViewport();
      const caixa = await lateral.boundingBox();
      if (!caixa) throw new Error("barra lateral sem caixa delimitadora");
      expect(caixa.y).toBeGreaterThanOrEqual(0);
      expect(caixa.y + caixa.height).toBeLessThanOrEqual(1194);
    });
  });
});
