/**
 * E39c, parte 2b: mover um item de dia arrastando, na Semana e no Mês, do tablet deitado para
 * cima (1024px ou mais); o caminho pelo teclado (o menu de três ações, "Não vou gravar hoje", a
 * folha "Mudar o dia") é o mesmo de sempre, só verificado aqui onde esta etapa mexeu (a visão
 * Mês, que não tinha o menu). Semana inteira fixa no futuro (2027-03-08 a 2027-03-14, uma
 * quarta-feira qualquer bem à frente), para o teste nunca cair perto de "hoje" de verdade e um
 * dia virar "passado" sozinho com o tempo.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-planejador-arrasto@exemplo.teste";

const DIA_ORIGEM = "2027-03-09"; // terça-feira
const DIA_VAZIO = "2027-03-11"; // quinta-feira, sem nada
const DIA_COM_REELS = "2027-03-12"; // sexta-feira, já tem um Reels

const CONTEUDO_MINIMO = {
  titulo: "um titulo de roteiro de teste",
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

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

let clienteId: number;

test.describe("planejador, mover de dia por arrasto (E39c, parte 2b)", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-planejador-arrasto"));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-planejador-arrasto"));
      clienteId = marca.id;
      return;
    }

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-planejador-arrasto", nome: "[teste] Planejador arrasto" }).returning();
    await db().insert(user).values({ id: "e2e-planejador-arrasto", name: "[teste] Planejador arrasto", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-planejador-arrasto-credential",
        issuer: "local:credential",
        accountId: "e2e-planejador-arrasto",
        providerId: "credential",
        userId: "e2e-planejador-arrasto",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-planejador-arrasto", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-planejador-arrasto", nome: "[teste] Planejador arrasto", nichoId: nicho.id })
      .returning();
    clienteId = marca.id;
    await db().insert(membrosMarca).values({ usuarioId: "e2e-planejador-arrasto", clienteId: marca.id, papel: "dono" });
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
        data: DIA_ORIGEM,
        tema: "o item que vai ser arrastado",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: { ...CONTEUDO_MINIMO, titulo: "o item que vai ser arrastado" },
        status: "gerado",
      });
    await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: DIA_COM_REELS,
        tema: "ja tem um reels aqui",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: { ...CONTEUDO_MINIMO, titulo: "ja tem um reels aqui" },
        status: "gerado",
      });
  });

  test("Semana, 1280px: arrastar para um dia vazio move na hora, sem perguntar nada", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("region", { name: /quinta-feira, 11 de março/i });
    await expect(origem).toBeVisible();
    await expect(destino).toBeVisible();

    await origem.dragTo(destino);

    await expect(page.getByRole("region", { name: /quinta-feira, 11 de março/i }).getByText("o item que vai ser arrastado")).toBeVisible();
    await expect(page.getByRole("region", { name: /terça-feira, 9 de março/i }).getByText("o item que vai ser arrastado")).toHaveCount(0);
  });

  test("Semana, 1280px: arrastar para um dia que já tem um Reels pede confirmação antes de mover", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("region", { name: /sexta-feira, 12 de março/i });
    await origem.dragTo(destino);

    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao).toBeVisible();
    await expect(confirmacao).toContainText("Reels");

    // Cancelar não move nada.
    await confirmacao.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirmacao).toBeHidden();
    await expect(page.getByRole("region", { name: /terça-feira, 9 de março/i }).getByText("o item que vai ser arrastado")).toBeVisible();

    // Arrastar de novo e confirmar move de verdade.
    await origem.dragTo(destino);
    await page.getByRole("alertdialog").getByRole("button", { name: "Mover mesmo assim" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByRole("region", { name: /sexta-feira, 12 de março/i }).getByText("o item que vai ser arrastado")).toBeVisible();
  });

  test("Semana, 390px: sem arrasto no celular, o caminho continua sendo o menu de três ações", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    // Abaixo de 1024px o gesto de arrasto é cancelado no `dragstart` (`useMoverDeDia.ts`); o
    // item tem que continuar no mesmo dia depois da tentativa.
    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("region", { name: /quinta-feira, 11 de março/i });
    await origem.dragTo(destino, { force: true }).catch(() => {});
    await expect(page.getByRole("region", { name: /terça-feira, 9 de março/i }).getByText("o item que vai ser arrastado")).toBeVisible();

    await origem.getByRole("button", { name: /Mais opções/ }).click();
    await page.getByRole("menuitem", { name: "Não vou gravar hoje" }).click();
    await expect(page.getByRole("dialog", { name: "Mudar o dia" })).toBeVisible();
  });

  test("Mês, 1280px: arrastar da lista do dia selecionado para outra célula do mês", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=mes&mes=2027-03&dia=${DIA_ORIGEM}`);

    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("button", { name: /11 de março/i });
    await expect(origem).toBeVisible();

    await origem.dragTo(destino);

    // O dia 9 continua selecionado: espera na própria página até o `router.refresh()` esvaziar a
    // lista dele, antes de navegar para o dia 11 (navegar cedo demais corre com a escrita no banco).
    await expect(page.getByText("o item que vai ser arrastado")).toHaveCount(0);

    await page.goto(`/planejamento?visao=mes&mes=2027-03&dia=${DIA_VAZIO}`);
    await expect(page.getByText("o item que vai ser arrastado")).toBeVisible();
  });

  test("Mês: o menu de três ações chega na lista do dia selecionado (pendência da parte 2a)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=mes&mes=2027-03&dia=${DIA_ORIGEM}`);

    const linha = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    await linha.getByRole("button", { name: /Mais opções/ }).click();
    await expect(page.getByRole("menuitem", { name: "Não vou gravar hoje" })).toBeVisible();
  });
});
