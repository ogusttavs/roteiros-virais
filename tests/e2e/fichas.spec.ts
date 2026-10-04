/**
 * As cinco fichas do "O que você quer que esse vídeo faça?" (E49 PR 1, passo 18 do Opus): a tela do Objetivo no Reels (as cinco, a recomendada pelo tema já marcada, a troca) e no
 * Story (sem fichas, com o cartão que explica por quê), a folha "Gravar agora" nos dois formatos, e o roteiro com "Para que ..." ao lado do tipo.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { desc, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, temasDia, user, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const ID = "e2e-fichas";
const EMAIL = "e2e-fichas@exemplo.teste";

const FICHAS = ["Que muita gente veja", "Que guardem para depois", "Que mandem para alguém", "Que comentem", "Que me chamem"];

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

async function ultimoRoteiro() {
  const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, ID));
  const [r] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marca.id)).orderBy(desc(roteiros.id)).limit(1);
  return r;
}

test.describe("as cinco fichas", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
    if (jaExiste) return;
    const [nicho] = await db().insert(nichos).values({ slug: ID, nome: "[teste] Fichas" }).returning();
    await db().insert(user).values({ id: ID, name: "[teste] Fichas", email: EMAIL });
    await db().insert(account).values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] Fichas", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "lavagem de estofados", preco: "sofá de 3 lugares por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "d1", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 2", descricao: "d2", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 3", descricao: "d3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
    // Seis vídeos postados, todos para mais gente te conhecer: "lembrarem de você" e "te chamarem" ficam em falta, e o tema do dia recomenda um deles.
    for (let i = 1; i <= 6; i++) {
      await db().insert(roteiros).values({
        clienteId: marca.id,
        data: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        tema: `histórico ${i}`,
        origem: "livre",
        objetivo: "alcance",
        conteudo: { titulo: `histórico ${i}`, duracaoS: 30, gancho: "g", corpo: "c", fechamento: "f", chamadaFinal: "x", edicao: {}, evidencias: [] } as never,
        status: "postado",
        postadoEm: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      } as never);
    }
  });

  test("Reels: as cinco fichas, a recomendada pelo tema já marcada, e a troca vale no roteiro", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    await expect(page.getByRole("heading", { name: "O que você quer que esse vídeo faça?" })).toBeVisible();
    const grupo = page.locator("[data-fichas]");
    for (const nome of FICHAS) await expect(grupo.getByRole("radio", { name: new RegExp(nome) })).toBeVisible();

    // A ficha recomendada pelo tema vem marcada, com o selo e o porquê.
    await expect(grupo.getByRole("radio", { name: /Recomendado hoje/ })).toHaveAttribute("aria-checked", "true");
    await expect(grupo).toContainText("Recomendado hoje");
    await expect(grupo).toContainText("A gente recomenda pelo tema");
    await expect(grupo).toContainText("Por exemplo:");
    await expect(grupo).toContainText("Ajuda em:");

    // Sem jargão do objetivo antigo na tela.
    const texto = (await page.locator("main").innerText()).toLowerCase();
    for (const proibida of ["engajamento", "alcance", "conversão", "salvamento"]) expect(texto).not.toContain(proibida);

    await grupo.getByRole("radio", { name: /Que me chamem/ }).click();
    await expect(grupo.getByRole("radio", { name: /Que me chamem/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    await expect(page.locator("[data-ficha-do-roteiro]")).toHaveText("Para que te chamem");
    const r = await ultimoRoteiro();
    expect(r.ficha).toBe("me_chamem");
    expect(r.objetivo).toBe("conversao");
  });

  test("Story: sem fichas, com o cartão que explica, e o roteiro sai sem ficha", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=1");
    await page.getByRole("tab", { name: "Story" }).click();
    await expect(page.getByRole("heading", { name: "Antes de escrever o seu Story" })).toBeVisible();
    await expect(page.locator("[data-fichas]")).toHaveCount(0);
    await expect(page.locator("[data-story-sem-pergunta]")).toContainText("No Story, a conversa é com quem já te segue");
    await expect(page.getByRole("button", { name: "escrever o roteiro" })).toBeEnabled();
    // Volta ao Reels: as fichas voltam.
    await page.getByRole("tab", { name: "Reels" }).click();
    await expect(page.locator("[data-fichas]")).toBeVisible();
    await page.getByRole("tab", { name: "Story" }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    await expect(page.locator("[data-ficha-do-roteiro]")).toHaveCount(0);
    const r = await ultimoRoteiro();
    expect(r.formato).toBe("story");
    expect(r.ficha).toBeNull();
  });

  test("Gravar agora: o formato vem antes; no Reels as cinco em chips só pelo nome; no Story, nenhuma pergunta", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Contar o momento" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();
    const fichas = folha.locator("[data-fichas]");
    await expect(fichas).toBeVisible();
    for (const nome of FICHAS) await expect(fichas.getByRole("button", { name: nome })).toBeVisible();
    // O formato aparece antes da pergunta na folha.
    const ordem = await folha.evaluate((el) => {
      const formato = el.querySelector('[role="tablist"]');
      const fichasEl = el.querySelector("[data-fichas]");
      return formato && fichasEl ? Boolean(formato.compareDocumentPosition(fichasEl) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
    });
    expect(ordem).toBe(true);

    await fichas.getByRole("button", { name: "Que comentem" }).click();
    await folha.getByLabel("Onde você está").fill("na oficina, de manhã");
    await folha.getByLabel("O que está acontecendo").fill("chegou um sofá muito manchado");
    await folha.getByLabel("O que dá para mostrar").fill("o antes e o depois");
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    expect((await ultimoRoteiro()).ficha).toBe("comentem");

    await page.goto("/criar");
    await page.getByRole("button", { name: "Contar o momento" }).click();
    const folha2 = page.getByRole("dialog", { name: "Gravar agora" });
    await folha2.getByRole("tab", { name: "Story" }).click();
    await expect(folha2.locator("[data-fichas]")).toHaveCount(0);
    await expect(folha2).toContainText("No Story não tem a pergunta do que o vídeo deve fazer");
  });
});
