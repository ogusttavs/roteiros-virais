/**
 * Hotfix de 05/10/2026: na tela do roteiro de Reels falado, "Como editar" e "Por que assim" apareciam uma por cima da outra (as duas eram `.ladoGrudado`, a mesma área da grade do
 * desktop, desde que o Reels passou a trazer as regras da plataforma). Confere, a 390 e a 1280, que as caixas das seções do roteiro não se cruzam e que seguem em sequência (uma
 * depois da outra, na ordem do documento). Guarda também uma captura de cada largura em `test-results/`.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type ConteudoRoteiro } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-sem-sobreposicao@exemplo.teste";
const TEMA = "roteiro reels com as regras da plataforma";
let roteiroId: number;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

function secao(page: Page, titulo: string): Locator {
  return page.locator("section", { has: page.getByRole("heading", { name: titulo, exact: true }) });
}

type Caixa = { x: number; y: number; width: number; height: number };

function seCruzam(a: Caixa, b: Caixa): boolean {
  const horizontal = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1;
  const vertical = a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  return horizontal && vertical;
}

test.describe("roteiro de Reels: as seções não se sobrepõem", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-sem-sobreposicao"));
    if (!existente) {
      const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
      await db().insert(user).values({ id: "e2e-sem-sobreposicao", name: "[teste] Sem sobreposicao", email: EMAIL });
      await db().insert(account).values({ id: "e2e-sem-sobreposicao-credential", issuer: "local:credential", accountId: "e2e-sem-sobreposicao", providerId: "credential", userId: "e2e-sem-sobreposicao", password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-sem-sobreposicao", nome: "[teste] Sem sobreposicao", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: "e2e-sem-sobreposicao", clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-sem-sobreposicao", aceitouTermosEm: new Date() });
      await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
      const conteudo: ConteudoRoteiro = {
        titulo: TEMA,
        duracaoS: 40,
        gancho: "gancho do roteiro",
        corpo: "corpo do roteiro com bastante texto para ocupar a coluna de leitura",
        fechamento: "fechamento do roteiro",
        chamadaFinal: "chamada final do roteiro",
        cartoes: null,
        porQueAssim: [
          { regra: "R-IG-REEL-05", motivo: "o gancho entrega a promessa nos primeiros segundos, como a regra pede" },
          { regra: "R-IG-REEL-02", motivo: "o vídeo termina antes do teto de duração da rede" },
        ],
        cenas: [{ momento: "abertura", oQueFazer: "mostrar o produto" }],
        ondeGravar: "na sala",
        edicao: {
          textoNaTela: [
            { quando: "0 a 3 s", oQue: "texto da abertura", onde: "topo" },
            { quando: "30 s", oQue: "texto do fechamento", onde: "centro" },
          ],
          ritmoDeCorte: "moderado",
          recursos: ["zoom leve"],
          audio: null,
          referencia: null,
        },
        evidencias: [],
        semEvidencia: true,
        forcaEvidencia: null,
      };
      await db().insert(roteiros).values({ clienteId: cliente.id, data: "2026-01-01", tema: TEMA, origem: "sugerido", objetivo: "conversao", formato: "reels", estilo: "falado", conteudo });
    }
    const [r] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.tema, TEMA));
    roteiroId = r.id;
  });

  for (const largura of [390, 768, 1024, 1280]) {
    test(`a ${largura}px: "Como editar" e "Por que assim" existem, não se cruzam e vêm um depois do outro`, async ({ page }, info) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await entrar(page);
      await page.goto(`/roteiros/${roteiroId}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const como = secao(page, "Como editar");
      const porque = secao(page, "Por que assim");
      await expect(como).toBeVisible();
      await expect(porque).toBeVisible();
      await page.screenshot({ path: info.outputPath(`roteiro-${largura}.png`), fullPage: true });

      const a = (await como.boundingBox())!;
      const b = (await porque.boundingBox())!;
      expect(seCruzam(a, b), `as caixas se cruzam a ${largura}px: ${JSON.stringify(a)} e ${JSON.stringify(b)}`).toBe(false);

      // Na mesma coluna uma vem depois da outra; em colunas diferentes, nunca ao mesmo tempo no mesmo trecho vertical.
      const naMesmaColuna = Math.abs(a.x - b.x) < 8;
      if (naMesmaColuna) expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);

      // Nenhuma das duas atravessa a borda da tela.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
