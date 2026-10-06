/**
 * O passo 19 do Opus (`Roteiro.dc.html`, estados `reprovarFolha`, `reprovarPainel`, `reescrevendo` e `refeito`), a 390 e a 1280: do desktop (1024px) para cima o reprovar é um painel lateral de 25rem
 * (o lado da tela e a barra de ações saem enquanto ele está aberto, os motivos viram uma lista de caixas); abaixo disso, a folha com os motivos em duas colunas e o X; o botão fica apagado
 * até marcar um motivo; ao reescrever, a espera da claquete assume (com o que a pessoa marcou e "Voltar depois") e, quando o roteiro novo chega, ele diz "Refeito porque: ...".
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, geracoesIA, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type ConteudoRoteiro } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-reprovar-painel@exemplo.teste";
const TEMA = "roteiro para reprovar no painel";
let roteiroId: number;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Cada teste reprova um roteiro próprio (uma série nova): o reprovar cria a versão 2 do mesmo. */
async function novoRoteiro(): Promise<number> {
  const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-reprovar-painel"));
  const conteudo: ConteudoRoteiro = {
    titulo: TEMA,
    duracaoS: 30,
    gancho: "gancho de teste",
    corpo: "corpo de teste",
    fechamento: "fechamento de teste",
    chamadaFinal: "chamada final de teste",
    cartoes: null,
    porQueAssim: [{ regra: "R-IG-REEL-05", motivo: "o gancho entrega a promessa cedo" }],
    cenas: [{ momento: "0 a 3 s", oQueFazer: "mostrar o produto" }],
    ondeGravar: "na sala",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
  };
  // Com a geração por trás (é dela que a reprovação lê os motivos, como em produção).
  const [geracao] = await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "0", modelo: "mock", entradas: {}, clienteId: marca.id, custoUsd: "0" } as never).returning({ id: geracoesIA.id });
  const [r] = await db()
    .insert(roteiros)
    .values({ geracaoId: geracao.id, clienteId: marca.id, data: "2026-01-01", tema: TEMA, origem: "livre", objetivo: "conversao", formato: "reels", estilo: "falado", conteudo })
    .returning({ id: roteiros.id });
  return r.id;
}

test.describe("reprovar: o painel lateral, a folha, a espera e o 'Refeito porque'", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-reprovar-painel"));
    if (!existente) {
      const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
      await db().insert(user).values({ id: "e2e-reprovar-painel", name: "[teste] Reprovar painel", email: EMAIL });
      await db().insert(account).values({ id: "e2e-reprovar-painel-credential", issuer: "local:credential", accountId: "e2e-reprovar-painel", providerId: "credential", userId: "e2e-reprovar-painel", password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-reprovar-painel", nome: "[teste] Reprovar painel", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: "e2e-reprovar-painel", clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-reprovar-painel", aceitouTermosEm: new Date() });
      await db().insert(briefings).values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: { oQueVende: "limpeza de estofados", preco: "sofá por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
          resumo: "limpa estofados em domicílio",
          referencias: [],
        },
      });
    }
  });

  test("a 1280: o painel lateral de 25rem encosta na direita, o lado e a barra saem, e os motivos são uma coluna de caixas", async ({ page }) => {
    roteiroId = await novoRoteiro();
    await page.setViewportSize({ width: 1280, height: 720 });
    await entrar(page);
    await page.goto(`/roteiros/${roteiroId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Reprovar", exact: true }).first().click();

    const painel = page.getByRole("dialog", { name: "O que não ficou bom?" });
    await expect(painel).toBeVisible();
    await expect(painel).toHaveAttribute("data-painel-lateral", "");
    await page.waitForTimeout(600);
    const caixa = (await painel.boundingBox())!;
    expect(Math.round(caixa.width)).toBe(400);
    expect(Math.round(caixa.x + caixa.width)).toBe(1280);
    expect(Math.round(caixa.height)).toBe(720);
    // O rodapé com o botão fica à vista mesmo numa janela baixa.
    const botaoCaixa = (await painel.getByRole("button", { name: "Reescrever o roteiro" }).boundingBox())!;
    expect(botaoCaixa.y + botaoCaixa.height).toBeLessThanOrEqual(720);

    // O lado da tela e a barra de ações saem (continuam no documento, só não aparecem).
    await expect(page.getByText("Como editar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeHidden();

    // Uma coluna só: todos os motivos no mesmo x.
    const botoes = painel.locator("[data-motivos-reprovar] button");
    expect(await botoes.count()).toBeGreaterThanOrEqual(7);
    const xs = new Set<number>();
    for (let i = 0; i < (await botoes.count()); i += 1) xs.add(Math.round((await botoes.nth(i).boundingBox())!.x));
    expect(xs.size).toBe(1);

    // O X fecha, e o lado volta.
    await painel.getByRole("button", { name: "Fechar" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByText("Como editar")).toBeVisible();
  });

  test("a 390: a folha com os motivos em duas colunas, o X, o botão apagado até marcar um motivo e a frase que diz o que falta", async ({ page }) => {
    roteiroId = await novoRoteiro();
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto(`/roteiros/${roteiroId}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Reprovar" }).click();

    const folha = page.getByRole("dialog", { name: "O que não ficou bom?" });
    await expect(folha).toBeVisible();
    await page.waitForTimeout(600);
    const botoes = folha.locator("[data-motivos-reprovar] button");
    const primeiro = (await botoes.nth(0).boundingBox())!;
    const segundo = (await botoes.nth(1).boundingBox())!;
    expect(Math.abs(primeiro.y - segundo.y)).toBeLessThan(4);
    expect(segundo.x).toBeGreaterThan(primeiro.x + primeiro.width - 1);

    const reescrever = folha.getByRole("button", { name: "Reescrever o roteiro" });
    await expect(reescrever).toBeDisabled();
    await expect(folha.getByText("Marque pelo menos um motivo para reescrever")).toBeVisible();
    await botoes.nth(0).click();
    await expect(reescrever).toBeEnabled();
    await expect(folha.getByText("Pode levar até 3 minutos. O tema e o objetivo continuam os mesmos.")).toBeVisible();
    await folha.getByRole("button", { name: "Fechar" }).click();
    await expect(folha).toBeHidden();
  });

  test("reescrever: a espera da claquete mostra o que foi marcado, e o roteiro novo abre sozinho dizendo 'Refeito porque'", async ({ page }) => {
    roteiroId = await novoRoteiro();
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    // O servidor responde na hora em mock: segura a reescrita uns segundos para a espera poder ser vista.
    await page.route(new RegExp(`/roteiros/${roteiroId}$`), async (rota) => {
      if (rota.request().method() === "POST") await new Promise((r) => setTimeout(r, 3000));
      await rota.continue();
    });
    await page.goto(`/roteiros/${roteiroId}`);
    await page.getByRole("button", { name: "Reprovar", exact: true }).first().click();
    const painel = page.getByRole("dialog", { name: "O que não ficou bom?" });
    await painel.getByRole("button", { name: "Gancho fraco", exact: true }).click();
    await painel.getByRole("button", { name: "Já falei disso", exact: true }).click();
    await painel.getByLabel("Se quiser, diga com as suas palavras").fill("o gancho comecava com pergunta");
    await painel.getByRole("button", { name: "Reescrever o roteiro" }).click();

    const espera = page.locator("[data-reescrevendo]");
    await expect(espera).toBeVisible();
    await expect(espera).toContainText("Reescrevendo o seu roteiro");
    await expect(espera).toContainText("Reescrevendo com o que você disse");
    await expect(espera.locator("[data-voce-marcou]")).toContainText("Você marcou: já falei disso e gancho fraco");
    await expect(espera).toContainText("Guardando o que você não gostou");
    await expect(espera).toContainText("Conferindo se continua sendo para que te chamem");
    await expect(espera.getByRole("button", { name: "Voltar depois" })).toBeVisible();
    // O painel não fica por trás da espera.
    await expect(painel).toBeHidden();

    // O roteiro novo chega e abre sozinho, com o porquê logo abaixo da linha do tipo.
    await expect(page).not.toHaveURL(new RegExp(`/roteiros/${roteiroId}$`), { timeout: 20_000 });
    await expect(espera).toHaveCount(0);
    const refeito = page.locator("[data-refeito-porque]");
    await expect(refeito).toContainText("Refeito porque: gancho fraco e já falei disso.");
    await expect(refeito).toContainText("Você disse: “o gancho comecava com pergunta”");
  });
});
