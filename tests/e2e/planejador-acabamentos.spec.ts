/**
 * Três acabamentos da E39c, parte 2a (revisão do Fable no PR #95, 02/10/2026): a folha do menu de
 * três ações ganha título visível e X; "Abrir o roteiro" não quebra em duas linhas ao lado de
 * "Mais opções" a 360px; abaixo de 768px, o período da visão Semana usa a forma curta.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  user,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-planejador-acabamentos@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const CONTEUDO_MINIMO = {
  titulo: "um titulo de roteiro longo o bastante para testar a quebra de linha",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

let clienteId: number;

test.describe("planejador, três acabamentos da revisão do PR #95", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-planejador-acabamentos"));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-planejador-acabamentos"));
      clienteId = marca.id;
      return;
    }

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-planejador-acabamentos", nome: "[teste] Planejador acabamentos" }).returning();
    await db().insert(user).values({ id: "e2e-planejador-acabamentos", name: "[teste] Planejador acabamentos", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-planejador-acabamentos-credential",
        issuer: "local:credential",
        accountId: "e2e-planejador-acabamentos",
        providerId: "credential",
        userId: "e2e-planejador-acabamentos",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-planejador-acabamentos", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-planejador-acabamentos", nome: "[teste] Planejador acabamentos", nichoId: nicho.id })
      .returning();
    clienteId = marca.id;
    await db().insert(membrosMarca).values({ usuarioId: "e2e-planejador-acabamentos", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofá de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
  });

  test.beforeEach(async () => {
    await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
    await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: hojeISO(),
        tema: "tema de teste",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: CONTEUDO_MINIMO,
        status: "gerado",
      });
  });

  test("a 360px, 'Abrir o roteiro' cabe numa linha só ao lado de 'Mais opções'", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await entrar(page);
    await page.goto("/planejamento?visao=dia");

    const botaoAbrir = page.getByRole("button", { name: "Abrir o roteiro" });
    await expect(botaoAbrir).toBeVisible();
    const caixa = (await botaoAbrir.boundingBox())!;
    // Uma linha de texto nesse botão (min-height de --altura-toque-lg, medida real 52px) nunca
    // passa de 56px; duas linhas (o defeito que este teste cobre) empurram a altura para 70px ou
    // mais, por causa do padding vertical somado à segunda linha.
    expect(caixa.height).toBeLessThan(56);

    // "Mais opções" vira só o ícone abaixo de 480px (acabamento 2): o texto não aparece.
    await expect(page.getByText("Mais opções", { exact: true })).toBeHidden();
  });

  test("a partir de 480px, 'Mais opções' volta a aparecer por escrito ao lado do ícone", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await entrar(page);
    await page.goto("/planejamento?visao=dia");

    await expect(page.getByRole("button", { name: "Abrir o roteiro" })).toBeVisible();
    await expect(page.getByText("Mais opções", { exact: true })).toBeVisible();
  });

  test("o menu de três ações mostra um título visível e um X para fechar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await entrar(page);
    await page.goto("/planejamento?visao=dia");

    await page.getByRole("button", { name: /Mais opções/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("heading", { name: /Mais opções/ })).toBeVisible();

    const botaoFechar = menu.getByRole("button", { name: "Fechar" });
    await expect(botaoFechar).toBeVisible();
    await botaoFechar.click();
    await expect(menu).toBeHidden();
  });

  test("abaixo de 768px, o período da semana usa a forma curta; a partir de 768px, a forma longa", async ({ page }) => {
    await entrar(page);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/planejamento?visao=semana");
    const tituloEstreito = await page.locator("h1").first().innerText();
    expect(tituloEstreito).not.toContain(" de ");
    expect(/^\d+( [a-zç]+)? a \d+ [a-zç]+$/.test(tituloEstreito.trim())).toBe(true);

    await page.setViewportSize({ width: 768, height: 800 });
    const tituloLargo = await page.locator("h1").first().innerText();
    expect(tituloLargo).toContain(" de ");
  });
});
