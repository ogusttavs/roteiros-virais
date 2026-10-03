/**
 * A2, item 7 (pedido do Gustavo no iPhone): em Hoje, "Stories de hoje" ganha um botão sempre visível, "Criar um Story para hoje", com ou sem Story marcado.
 * Sem Story ele substitui o "Nada marcado"; com Story marcado ele fica abaixo da lista. É um atalho para o Criar: abre "Gravar agora" já em Story e com o dia de
 * hoje, para a pessoa não escolher de novo. Hoje continua sendo só a agenda (nada se cria dentro dele). Em outro dia o botão não aparece.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const BOTAO = "Criar um Story para hoje";

function email(usuarioId: string): string {
  return `${usuarioId}@exemplo.teste`;
}

async function criarMarca(usuarioId: string): Promise<number> {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (jaExiste) {
    const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, usuarioId));
    await db().delete(roteiros).where(eq(roteiros.clienteId, marca.id));
    return marca.id;
  }
  const [nicho] = await db().insert(nichos).values({ slug: `${usuarioId}-nicho`, nome: "[teste] Oficina" }).returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Story", email: email(usuarioId) });
  await db()
    .insert(account)
    .values({
      id: `${usuarioId}-credential`,
      issuer: "local:credential",
      accountId: usuarioId,
      providerId: "credential",
      userId: usuarioId,
      password: await hashPassword(SENHA),
    });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Story ${usuarioId}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "conserto de eletrodomésticos",
          preco: "revisão simples por R$ 90",
          clienteIdeal: "mora perto da oficina",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "conserta eletrodomésticos na oficina própria",
        referencias: [],
      },
    });
  return marca.id;
}

async function criarStoryMarcado(clienteId: number, titulo: string) {
  await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: hojeISO(),
      tema: `tema de ${titulo}`,
      origem: "sugerido",
      objetivo: "engajamento",
      formato: "story",
      momentoDoDia: "manha",
      conteudo: {
        titulo,
        duracaoS: 15,
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
      } as never,
      status: "gerado",
    });
}

async function entrar(page: Page, usuarioId: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(usuarioId));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("Hoje: Criar um Story para hoje", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sem nada marcado o botão aparece, e leva ao Criar com Gravar agora já em Story e o dia de hoje", async ({ page }) => {
    await criarMarca("e2e-hoje-story-vazio");
    await entrar(page, "e2e-hoje-story-vazio");

    const botao = page.getByRole("button", { name: BOTAO });
    await expect(botao).toBeVisible();
    await botao.click();

    await expect(page).toHaveURL(new RegExp(`/criar\\?data=${hojeISO()}&formato=story`));
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();
    await expect(folha.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
    await expect(folha.getByRole("tab", { name: "Reels" })).toHaveAttribute("aria-selected", "false");
  });

  test("só com um Reels marcado, a coluna de Stories troca o 'Nada marcado' pelo botão", async ({ page }) => {
    const marca = await criarMarca("e2e-hoje-story-so-reels");
    await db()
      .insert(roteiros)
      .values({
        clienteId: marca,
        data: hojeISO(),
        tema: "tema do reels",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: {
          titulo: "o reels do dia",
          duracaoS: 40,
          gancho: "g",
          corpo: "c",
          fechamento: "f",
          chamadaFinal: "x",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "no local",
          edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: true,
          forcaEvidencia: null,
        } as never,
        status: "gerado",
      });
    await entrar(page, "e2e-hoje-story-so-reels");

    const secao = page.locator("section", { has: page.getByRole("heading", { name: "Stories de hoje" }) });
    await expect(secao.getByRole("button", { name: BOTAO })).toBeVisible();
    await expect(secao.getByText("Nada marcado")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir o roteiro" })).toBeVisible();
  });

  test("com um Story marcado a lista aparece e o botão continua embaixo dela", async ({ page }) => {
    const marca = await criarMarca("e2e-hoje-story-com");
    await criarStoryMarcado(marca, "story da manha");
    await entrar(page, "e2e-hoje-story-com");

    const secao = page.locator("section", { has: page.getByRole("heading", { name: "Stories de hoje" }) });
    const item = secao.getByText("story da manha");
    const botao = secao.getByRole("button", { name: BOTAO });
    await expect(item).toBeVisible();
    await expect(botao).toBeVisible();
    const caixaItem = await item.boundingBox();
    const caixaBotao = await botao.boundingBox();
    expect(caixaBotao!.y).toBeGreaterThan(caixaItem!.y + caixaItem!.height - 1);

    await botao.click();
    await expect(page).toHaveURL(/\/criar\?data=\d{4}-\d{2}-\d{2}&formato=story/);
    await expect(page.getByRole("dialog", { name: "Gravar agora" }).getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
  });

  test("fechar a folha de Gravar agora não a reabre sozinha, e o Criar sem ?formato abre normal (sem folha)", async ({ page }) => {
    await criarMarca("e2e-hoje-story-fechar");
    await entrar(page, "e2e-hoje-story-fechar");
    await page.getByRole("button", { name: BOTAO }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByRole("button", { name: /fechar|cancelar/i }).first().click();
    await expect(folha).toHaveCount(0);
    await page.waitForTimeout(1000);
    await expect(page.getByRole("dialog", { name: "Gravar agora" })).toHaveCount(0);

    await page.goto("/criar");
    await page.waitForTimeout(1000);
    await expect(page.getByRole("dialog", { name: "Gravar agora" })).toHaveCount(0);
  });
});
