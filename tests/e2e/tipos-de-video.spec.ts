/**
 * Os tipos de vídeo (E44 PR 2, desenho do passo 17): o cartão no último bloco do Começar e no Briefing, a folha da Conta, a folha do admin (a troca do admin por cima, "voltar
 * ao que o cliente escolheu"), o selo nas Referências e no roteiro, e o cabeçalho de vidro (passo 17b) no celular.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { perguntasDoBloco } from "../../src/config/briefing";
import { db } from "../../src/db";
import { account, briefings, clientes, formatosDaMarca, membrosMarca, nichos, preferenciasUsuario, roteiros, user, videos, contas, type AvaliacaoResposta } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const ID = "e2e-tipos";
const EMAIL = `${ID}@exemplo.teste`;
const ID_B = "e2e-tipos-b";
const EMAIL_B = `${ID_B}@exemplo.teste`;
const ID_ADMIN = "e2e-tipos-admin";
const EMAIL_ADMIN = `${ID_ADMIN}@exemplo.teste`;

// A: o briefing ainda não terminou (o Começar abre no último bloco). B: o briefing completo (Briefing, Conta, Referências, roteiro e admin).
let clienteA: number;
let clienteId: number;
let roteiroId: number;

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

const CONTEUDO = {
  titulo: "um roteiro de teste",
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

test.describe("tipos de vídeo (E44 PR 2)", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
    if (jaExiste) {
      const [a] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID));
      const [b] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID_B));
      clienteA = a.id;
      clienteId = b.id;
      const [r] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.clienteId, b.id));
      roteiroId = r.id;
      return;
    }
    const [nicho] = await db().insert(nichos).values({ slug: ID, nome: "[teste] Tipos de vídeo" }).returning();
    for (const [id, email, role] of [
      [ID, EMAIL, null],
      [ID_B, EMAIL_B, null],
      [ID_ADMIN, EMAIL_ADMIN, "admin"],
    ] as const) {
      await db().insert(user).values({ id, name: `[teste] ${id}`, email, role });
      await db()
        .insert(account)
        .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
      await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
    }
    const [marcaA] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] Tipos A", nichoId: nicho.id, alcance: "brasil" }).returning();
    const [marcaB] = await db().insert(clientes).values({ usuarioId: ID_B, nome: "[teste] Tipos B", nichoId: nicho.id, alcance: "brasil" }).returning();
    clienteA = marcaA.id;
    clienteId = marcaB.id;
    await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marcaA.id, papel: "dono" });
    await db().insert(membrosMarca).values({ usuarioId: ID_B, clienteId: marcaB.id, papel: "dono" });

    // A: o briefing com os blocos 1 a 4 avaliados, sem terminar: o Começar abre no bloco 5, onde mora o cartão dos tipos.
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    const respostas: Record<string, string> = {};
    for (let bloco = 1; bloco <= 4; bloco++) {
      for (const pergunta of perguntasDoBloco(bloco, "negocio")) {
        avaliacoes[pergunta.id] = { nota: 9, bom: "ok", melhorar: "ok", como: "ok", impacto: "ok" };
        respostas[pergunta.id] = "uma resposta de teste bem completa para esta pergunta";
      }
    }
    await db().insert(briefings).values({ clienteId: marcaA.id, respostas, avaliacoes, notaGeral: "7.00", completo: false });
    // B: o briefing completo, com um perfil compilado (as telas do painel abrem).
    await db()
      .insert(briefings)
      .values({
        clienteId: marcaB.id,
        completo: true,
        perfil: {
          fatos: { oQueVende: "limpeza", preco: "a partir de 89", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
          resumo: "marca de limpeza",
          referencias: [],
        },
      });

    const [roteiro] = await db()
      .insert(roteiros)
      .values({ clienteId: marcaB.id, data: new Date().toISOString().slice(0, 10), tema: "tema", origem: "sugerido", objetivo: "engajamento", formato: "reels", conteudo: CONTEUDO, status: "gerado" })
      .returning();
    roteiroId = roteiro.id;
  });

  test.beforeEach(async () => {
    await db().delete(formatosDaMarca).where(eq(formatosDaMarca.clienteId, clienteId));
    await db().delete(formatosDaMarca).where(eq(formatosDaMarca.clienteId, clienteA));
  });

  test("Começar: o cartão no último bloco, os padrões (8 de 13), três trocas ('3 trocados por você') gravadas na hora", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL);
    await page.goto("/comecar");
    await expect(page.getByRole("heading", { name: "Que tipos de vídeo combinam com você?" })).toBeVisible();
    await expect(page.getByText("8", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("como a gente sugere")).toBeVisible();

    const lista = page.getByRole("list", { name: "Tipos de vídeo" }).first();
    await expect(lista.getByRole("switch")).toHaveCount(13);
    // Os padrões: as oito ligadas do estudo, as cinco desligadas.
    await expect(lista.getByRole("switch", { name: "Passo a passo" })).toHaveAttribute("aria-checked", "true");
    await expect(lista.getByRole("switch", { name: "Respondendo pergunta ou caixinha" })).toHaveAttribute("aria-checked", "true");
    await expect(lista.getByRole("switch", { name: "Humor e meme" })).toHaveAttribute("aria-checked", "false");
    await expect(lista.getByRole("switch", { name: "Opinião direta" })).toHaveAttribute("aria-checked", "false");

    // Três trocas: liga Opinião direta e Teste ou desafio, desliga Lista.
    await lista.getByRole("switch", { name: "Opinião direta" }).click();
    await lista.getByRole("switch", { name: "Teste ou desafio" }).click();
    await lista.getByRole("switch", { name: "Lista" }).click();
    await expect(page.getByText("3 trocados por você")).toBeVisible();
    await expect(lista.getByText("você ligou")).toHaveCount(2);
    await expect(lista.getByText("você desligou")).toHaveCount(1);
    await expect(lista.getByText("Por exemplo:").first()).toBeVisible();

    // Gravou na hora, como resposta do cliente (nunca do admin).
    await expect.poll(async () => (await db().select().from(formatosDaMarca).where(eq(formatosDaMarca.clienteId, clienteA))).length).toBe(3);
    const linhas = await db().select().from(formatosDaMarca).where(eq(formatosDaMarca.clienteId, clienteA));
    expect(linhas.every((l) => l.quem === "cliente")).toBe(true);

    await page.reload();
    await expect(page.getByText("3 trocados por você")).toBeVisible();
  });

  test("a chave é um switch: Espaço troca pelo teclado, e a troca vale na hora no resumo", async ({ page }) => {
    await entrar(page, EMAIL_B);
    await page.goto("/briefing");
    const chave = page.getByRole("switch", { name: "Humor e meme" });
    await chave.scrollIntoViewIfNeeded();
    await chave.focus();
    await page.keyboard.press("Space");
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("você ligou")).toBeVisible();
    await expect.poll(async () => (await db().select().from(formatosDaMarca).where(and(eq(formatosDaMarca.clienteId, clienteId), eq(formatosDaMarca.chave, "humor_e_meme")))).length).toBe(1);
  });

  test("Briefing: cartão editável no lugar, 'respondido em ...' depois de responder, sem botão de salvar", async ({ page }) => {
    await db().insert(formatosDaMarca).values({ clienteId, chave: "lista", ligada: false, quem: "cliente" });
    await entrar(page, EMAIL_B);
    await page.goto("/briefing");
    await expect(page.getByRole("heading", { name: "Que tipos de vídeo combinam com você" })).toBeVisible();
    await expect(page.getByText(/respondido em \d+ de /)).toBeVisible();
    await expect(page.getByRole("switch", { name: "Lista" })).toHaveAttribute("aria-checked", "false");
    await page.getByRole("switch", { name: "Bastidor" }).click();
    await expect(page.getByRole("switch", { name: "Bastidor" })).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await db().select().from(formatosDaMarca).where(and(eq(formatosDaMarca.clienteId, clienteId), eq(formatosDaMarca.chave, "bastidor")))).length).toBe(1);
  });

  test("Conta: o cartão 'Tipos de vídeo' abre a folha com a mesma lista, editável, com 'Pronto'", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL_B);
    await page.goto("/conta");
    const abrir = page.getByRole("button", { name: /Tipos de vídeo/ });
    await expect(abrir).toContainText("8 ligados de 13");
    await abrir.click();
    const folha = page.getByRole("dialog", { name: "Tipos de vídeo" });
    await expect(folha.getByRole("switch")).toHaveCount(13);
    await folha.getByRole("switch", { name: "Cena encenada" }).click();
    await expect(folha.getByText("9")).toBeVisible();
    await folha.getByRole("button", { name: "Pronto" }).click();
    await expect(folha).toHaveCount(0);
    await expect(abrir).toContainText("9 ligados de 13");
  });

  test("admin: 'Ver e ajustar' abre as treze, o ajuste do admin vale por cima, e 'Voltar ao que o cliente escolheu' devolve a resposta do cliente", async ({ page }) => {
    await db().insert(formatosDaMarca).values({ clienteId, chave: "teste_ou_desafio", ligada: true, quem: "cliente" });
    await entrar(page, EMAIL_ADMIN);
    await page.goto(`/admin/clientes/${clienteId}`);
    await expect(page.getByText("9 ligados de 13")).toBeVisible();
    await page.getByRole("button", { name: "Ver e ajustar" }).click();
    const folha = page.getByRole("dialog", { name: /Tipos de vídeo de/ });
    await expect(folha.getByRole("switch")).toHaveCount(13);
    await expect(folha.locator('[data-tipo="teste_ou_desafio"]')).toContainText("Escolhido pelo cliente");
    await expect(folha.locator('[data-tipo="passo_a_passo"]')).toContainText("Padrão");

    // O admin desliga o que o cliente ligou: "Ajustado por você", com o que o cliente tinha.
    await folha.getByRole("switch", { name: "Teste ou desafio" }).click();
    const linha = folha.locator('[data-tipo="teste_ou_desafio"]');
    await expect(linha).toContainText("Ajustado por você");
    await expect(linha).toContainText("o cliente tinha ligado");
    await expect.poll(async () => (await db().select().from(formatosDaMarca).where(and(eq(formatosDaMarca.clienteId, clienteId), eq(formatosDaMarca.quem, "admin")))).length).toBe(1);

    await linha.getByRole("button", { name: "Voltar ao que o cliente escolheu" }).click();
    await expect(linha).toContainText("Escolhido pelo cliente");
    await expect(folha.getByRole("switch", { name: "Teste ou desafio" })).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await db().select().from(formatosDaMarca).where(and(eq(formatosDaMarca.clienteId, clienteId), eq(formatosDaMarca.quem, "admin")))).length).toBe(0);
  });

  test("o selo do tipo aparece no cartão das Referências e 'Tipo: ...' abaixo do título do roteiro; recorte de outro fica sem selo", async ({ page }) => {
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    const [conta] = await db().insert(contas).values({ plataforma: "tiktok", handle: `e2e-tipos-conta-${Date.now()}`, nichoId: marca.nichoId }).returning();
    const analise = { assunto: "a", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" };
    const [comTipo] = await db()
      .insert(videos)
      .values({ plataforma: "tiktok", idExterno: `e2e-tipos-erro-${Date.now()}`, url: "https://exemplo.invalido/e2e-tipos-erro", contaId: conta.id, nichoId: marca.nichoId, titulo: "um erro comum de teste", views: 500000, publicadoEm: new Date(), foraDaCurva: "9", idioma: "pt", analise: analise as never, formatoCatalogo: "erro_comum", serveDeModelo: true, tipoConteudo: "original" })
      .returning();
    await db().update(roteiros).set({ referenciaVideoId: comTipo.id }).where(eq(roteiros.id, roteiroId));

    await entrar(page, EMAIL_B);
    await page.goto("/referencias?periodo=90");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-selo-tipo]").filter({ hasText: "Erro comum" }).first()).toBeVisible();

    await page.goto(`/roteiros/${roteiroId}`);
    await expect(page.locator("[data-selo-tipo]").filter({ hasText: "Tipo: erro comum" })).toBeVisible();
  });

  test("cabeçalho de vidro no celular: sem fundo no topo, vidro depois de rolar, e o 'Atualizar' só com o ícone (o nome fica para o leitor de tela)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL_B);
    await page.goto("/conta");
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "body { padding-bottom: 1600px !important; }" });
    const cabecalho = page.locator("header[data-barra-topo]").first();

    const fundoNoTopo = await cabecalho.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fundoNoTopo).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await expect(cabecalho).not.toHaveAttribute("data-rolada", "");

    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(cabecalho).toHaveAttribute("data-rolada", "");
    await page.waitForTimeout(400);
    const fundoRolada = await cabecalho.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fundoRolada).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(await cabecalho.evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/blur/);

    // O botão é uma bolha de 44 px; o nome "Atualizar" continua para o leitor de tela (aria-label), sem texto à vista.
    const atualizar = page.getByRole("button", { name: "Atualizar" });
    const caixa = (await atualizar.boundingBox())!;
    expect(Math.round(caixa.width)).toBe(44);
    expect(Math.round(caixa.height)).toBe(44);
  });

  test("cabeçalho de vidro com 'reduzir movimento': o vidro continua e as transições ficam curtas", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL_B);
    await page.goto("/conta");
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "body { padding-bottom: 1600px !important; }" });
    await page.evaluate(() => window.scrollTo(0, 300));
    const cabecalho = page.locator("header[data-barra-topo]").first();
    await expect(cabecalho).toHaveAttribute("data-rolada", "");
    const duracao = await cabecalho.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duracao)).toBeLessThan(0.2);
  });
});
