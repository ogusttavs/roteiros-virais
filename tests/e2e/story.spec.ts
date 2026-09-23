/**
 * V9c, Story como formato (E34 enxuta, definição de pronto do `PROXIMO.md`):
 * a folha "Gravar agora" já mostra o controle em Story quando o objetivo
 * pede caixinha (R-IG-STORY-10, R-IG-REEL-11), o roteiro sai em cartões com
 * "Por que assim", e o modo gravação mostra um cartão por vez. Um Reels
 * continua funcionando do mesmo jeito de sempre, sem cartão nenhum.
 *
 * Mesma lição de `momento.spec.ts`: nicho próprio ("e2e-story"), sem linha
 * em `temas_dia` (a folha "Gravar agora" não depende de tema do dia), e a
 * geração passa pelo navegador contra o `AI_PROVIDER=mock` do servidor.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  temasDia,
  user,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-story@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("V9c, Story como formato", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-story", nome: "[teste] Story" }).returning();

    await db().insert(user).values({ id: "e2e-story", name: "[teste] Story", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-story-credential",
        issuer: "local:credential",
        accountId: "e2e-story",
        providerId: "credential",
        userId: "e2e-story",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-story", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-story", nome: "[teste] Story", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-story", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofa de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicilio",
        referencias: [],
      },
    });

    // O botao "Gravar agora" fica abaixo dos tres temas (item 3 da V9a): sem uma linha em
    // temas_dia para hoje, /hoje cai num estado que nao usa HojeTela (mesma licao de
    // momento.spec.ts). Os temas em si nao importam para este teste.
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("objetivo 'que te chamem para comprar' sugere Story, gera cartões com 'Por que assim', e o modo gravação mostra um cartão por vez", async ({
    page,
  }) => {
    await entrar(page);
    await page.goto("/hoje");

    await page.getByRole("button", { name: "Gravar agora" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("na loja");
    await folha.getByLabel("O que está acontecendo").fill("terminando de secar um sofa");
    await folha.getByLabel("O que dá para mostrar").fill("o sofa limpo e seco");
    await folha.getByRole("radio", { name: "Gente me chamar para comprar" }).click();

    const controleFormato = folha.getByRole("tablist", { name: "Formato" });
    await expect(controleFormato.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    await expect(page.getByText("Cartão 1").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Por que assim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Como editar" })).toHaveCount(0);

    await page.getByRole("link", { name: "Modo gravação" }).first().click();
    await expect(page).toHaveURL(/\/roteiros\/\d+\/gravar/);
    await expect(page.getByText("Cartão 1").first()).toBeVisible();
    await expect(page.getByText(/^\d+ de \d+$/)).toBeVisible();
  });

  test("objetivo 'que mais gente te conheça' continua um Reels normal, sem cartão nenhum", async ({ page }) => {
    await entrar(page);
    await page.goto("/hoje");

    await page.getByRole("button", { name: "Gravar agora" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("na loja");
    await folha.getByLabel("O que está acontecendo").fill("mostrando o antes e o depois");
    await folha.getByLabel("O que dá para mostrar").fill("o sofa manchado e depois limpo");
    await folha.getByRole("radio", { name: "Mais gente me conhecer" }).click();

    const controleFormato = folha.getByRole("tablist", { name: "Formato" });
    await expect(controleFormato.getByRole("tab", { name: "Reels" })).toHaveAttribute("aria-selected", "true");

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Como editar" })).toBeVisible();
    await expect(page.getByText("Cartão 1")).toHaveCount(0);
  });
});
