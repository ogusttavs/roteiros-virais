/**
 * Hotfix de 06/10/2026 (iPhone instalado): a barra "Modo gravação / Já gravei" do roteiro e a cápsula de abas ficavam paradas no meio da tela quando a pessoa rolava. Aqui, no Chromium
 * (o defeito do iOS instalado só se prova no aparelho), o que o código promete: com a página rolada até o fim a 390px, a barra de ações está colada no rodapé da janela e o último bloco do
 * conteúdo fica visível acima dela, no Reels falado e no Story; e nada no código mexe na `theme-color` ao rolar (`CorDaBarraDoSistema.test.tsx`).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type ConteudoRoteiro } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-barra-fixa@exemplo.teste";
const TEMA_REELS = "reels longo para a barra fixa";
const TEMA_STORY = "story longo para a barra fixa";
const LONGO = "Um texto bem comprido para a página passar de uma tela inteira e a barra de ações precisar acompanhar a rolagem até o fim. ".repeat(6);
const ids: Record<string, number> = {};

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("a barra de ações fica no rodapé durante a leitura inteira", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-barra-fixa"));
    if (!existente) {
      const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
      await db().insert(user).values({ id: "e2e-barra-fixa", name: "[teste] Barra fixa", email: EMAIL });
      await db().insert(account).values({ id: "e2e-barra-fixa-credential", issuer: "local:credential", accountId: "e2e-barra-fixa", providerId: "credential", userId: "e2e-barra-fixa", password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-barra-fixa", nome: "[teste] Barra fixa", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: "e2e-barra-fixa", clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-barra-fixa", aceitouTermosEm: new Date() });
      await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
      const base = {
        porQueAssim: [],
        ondeGravar: "na sala",
        edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: true,
        forcaEvidencia: null,
      };
      const reels: ConteudoRoteiro = { ...base, titulo: TEMA_REELS, duracaoS: 40, gancho: LONGO, corpo: LONGO, fechamento: LONGO, chamadaFinal: "FIM DO REELS", cartoes: null, cenas: [{ momento: "0 a 3 s", oQueFazer: "mostrar o produto" }] };
      const story: ConteudoRoteiro = {
        ...base,
        titulo: TEMA_STORY,
        duracaoS: 20,
        gancho: "",
        corpo: "",
        fechamento: "",
        chamadaFinal: "",
        cartoes: [1, 2, 3, 4].map((n) => ({ oQueFalar: `${LONGO} STORY ${n}`, oQueMostrar: "cena do story", textoNaTela: "texto na tela", figurinha: "nenhuma" as const })),
        cenas: [{ momento: "abertura", oQueFazer: "CENAS DO FIM DO STORY" }],
      };
      await db().insert(roteiros).values({ clienteId: cliente.id, data: "2026-01-01", tema: TEMA_REELS, origem: "sugerido", objetivo: "conversao", formato: "reels", estilo: "falado", conteudo: reels });
      await db().insert(roteiros).values({ clienteId: cliente.id, data: "2026-01-02", tema: TEMA_STORY, origem: "sugerido", objetivo: "conversao", formato: "story", estilo: "falado", conteudo: story });
    }
    for (const tema of [TEMA_REELS, TEMA_STORY]) {
      const [r] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.tema, tema));
      ids[tema] = r.id;
    }
  });

  for (const [rotulo, tema, ultimo] of [
    ["Reels falado", TEMA_REELS, "Outras versões deste tema"],
    ["Story", TEMA_STORY, "Outras versões deste tema"],
  ] as const) {
    test(`${rotulo} a 390 rolado até o fim: a barra cola no rodapé da janela e o fim do conteúdo aparece acima dela`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await entrar(page);
      await page.goto(`/roteiros/${ids[tema]}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // Rola em passos, como o dedo, até não haver mais página.
      for (let i = 0; i < 40; i += 1) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(40);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      await page.screenshot({ path: info.outputPath(`barra-${rotulo.replace(" ", "-")}-390.png`) });

      const barra = page.locator("[data-barra-acoes-propria]").first();
      const caixa = (await barra.boundingBox())!;
      const alturaDaJanela = await page.evaluate(() => window.innerHeight);
      expect(Math.round(caixa.y + caixa.height), "a barra deve terminar na borda de baixo da janela").toBe(alturaDaJanela);

      const fim = page.getByText(ultimo, { exact: false }).last();
      const caixaFim = (await fim.boundingBox())!;
      expect(caixaFim.y + caixaFim.height, "o fim do conteúdo fica acima da barra").toBeLessThanOrEqual(caixa.y + 1);
      await expect(fim).toBeInViewport();
    });
  }
});
