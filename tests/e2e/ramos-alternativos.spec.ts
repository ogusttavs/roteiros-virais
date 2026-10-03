/**
 * E45, PR 3: um ramo principal e até dois alternativos (só o admin liga), de ponta a ponta.
 *
 * - Admin: na página da marca liga dois ramos (com o aviso de custo antes de confirmar), o botão trava no máximo de dois, e tirar um ramo
 *   desliga o setor que ficou sem marca.
 * - Referências: a marca com dois ramos vê os vídeos dos dois e a pílula "Ramo" filtra.
 * - Tema livre: um assunto que só o ramo alternativo tem prova recebe a prova daquele ramo (e sem o alternativo ligado, não).
 *
 * Seguro para a repetição automática do Playwright (F1, item 4): cada teste põe a marca dele no estado de partida. Os setores dos ramos do
 * catálogo são criados aqui (ou reaproveitados) com piso zero, para o teste não depender do teto de setores novos do dia nem de views.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { ramoPorSlug } from "../../src/config/ramos";
import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  contas,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  ramosDaConta,
  user,
  videos,
} from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|admin)/);
}

/** O setor de um ramo do catálogo, ligado e com piso zero (cria se não existe; reaproveita o que já existe). */
async function setorDoCatalogo(slug: string): Promise<number> {
  const ramo = ramoPorSlug(slug)!;
  const [existente] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, slug));
  if (existente) {
    await db().update(nichos).set({ ativo: true, pisoViews: 0 }).where(eq(nichos.id, existente.id));
    return existente.id;
  }
  const [novo] = await db()
    .insert(nichos)
    .values({ slug: `e2e-catalogo-${slug}`, nome: ramo.nome, ramoCatalogo: slug, termos: [], pisoViews: 0 })
    .returning();
  return novo.id;
}

async function criarMarca(usuarioId: string, email: string, nome: string, nichoSlug: string, opcoes: { comBriefing?: boolean } = {}) {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (jaExiste) {
    const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, usuarioId));
    return marca;
  }
  const [principal] = await db().insert(nichos).values({ slug: nichoSlug, nome: `[teste] Principal ${nome}`, termos: [], pisoViews: 0 }).returning();
  await db().insert(user).values({ id: usuarioId, name: nome, email });
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
  const [marca] = await db().insert(clientes).values({ usuarioId, nome, nichoId: principal.id, tipo: "negocio", persona: "negocio", alcance: "brasil" }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  if (opcoes.comBriefing) {
    await db()
      .insert(briefings)
      .values({
        clienteId: marca.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "kit tira-mancha para estofados",
            preco: "kit a partir de 89 reais",
            clienteIdeal: "mora em apartamento",
            medos: [],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: [],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "marca propria de produtos de limpeza",
          referencias: [],
        },
      });
  }
  return marca;
}

async function semAlternativos(clienteId: number) {
  await db().delete(ramosDaConta).where(eq(ramosDaConta.clienteId, clienteId));
}

async function semearVideo(chave: string, nichoId: number, contaId: number, assunto: string) {
  const analise = {
    assunto,
    gancho: `gancho de ${assunto}`,
    estrutura: "mostra o antes e o depois",
    fechamento: "resumo",
    chamadaFinal: "comenta",
    formato: "fala_para_camera",
    porQueFuncionou: "mostra o produto agindo",
  };
  const [existente] = await db().select({ id: videos.id }).from(videos).where(eq(videos.idExterno, chave));
  if (existente) return;
  await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: chave,
      url: `https://exemplo.invalido/${chave}`,
      nichoId,
      contaId,
      titulo: assunto,
      views: 5000,
      foraDaCurva: "4.1",
      publicadoEm: new Date(),
      idioma: "pt",
      analise: analise as never,
    });
}

async function contaDoSetor(handle: string, nichoId: number): Promise<number> {
  const [existente] = await db().select({ id: contas.id }).from(contas).where(eq(contas.handle, handle));
  if (existente) return existente.id;
  const [nova] = await db().insert(contas).values({ plataforma: "youtube", handle, nichoId, medianaViews: "1000" }).returning();
  return nova.id;
}

test.describe("ramos alternativos: o admin liga e tira", () => {
  test("liga dois ramos com o aviso de custo, trava no máximo, e tirar desliga o setor que ficou sem marca", async ({ page }) => {
    const marca = await criarMarca("e2e-ramos-admin", "e2e-ramos-admin@exemplo.teste", "[teste] Ramos Admin", "e2e-ramos-admin-principal");
    await semAlternativos(marca.id);
    // Nutrição já é pesquisada (outra marca a usa, simulado: setor ligado); Advocacia está parada (vai começar hoje).
    const nutricao = await setorDoCatalogo("nutricao");
    const advocacia = await setorDoCatalogo("advocacia");
    await db().update(nichos).set({ ativo: false }).where(eq(nichos.id, advocacia));

    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, EMAIL_ADMIN);
    await page.goto(`/admin/clientes/${marca.id}`);

    const bloco = page.locator("[data-ramos-alternativos]");
    await expect(bloco.getByRole("heading", { name: "Ramos alternativos" })).toBeVisible();
    await expect(bloco.getByText("Nenhum ramo alternativo ligado.")).toBeVisible();

    // O primeiro: já pesquisado, sem custo novo.
    await bloco.getByRole("button", { name: "ligar outro ramo" }).click();
    await bloco.getByRole("combobox").fill("nutri");
    await page.getByRole("option", { name: /Nutrição/ }).first().click();
    await expect(bloco.locator("[data-previa-ramo='pesquisado']")).toContainText("já é pesquisado por outra marca, sem custo novo");
    await bloco.getByRole("button", { name: "ligar Nutrição" }).click();
    await expect(bloco.locator("[data-ramo-alternativo]")).toHaveCount(1);

    // O segundo: parado, vai começar a ser pesquisado hoje, com o custo dito antes.
    await bloco.getByRole("button", { name: "ligar outro ramo" }).click();
    await bloco.getByRole("combobox").fill("advoc");
    await page.getByRole("option", { name: /Advocacia/ }).first().click();
    await expect(bloco.locator("[data-previa-ramo='comeca']")).toContainText("vai começar a ser pesquisado hoje");
    await expect(bloco.locator("[data-previa-ramo='comeca']")).toContainText("US$ 0,60 por dia");
    await bloco.getByRole("button", { name: "ligar Advocacia" }).click();
    await expect(bloco.locator("[data-ramo-alternativo]")).toHaveCount(2);

    // Advocacia voltou a ser pesquisada ao ligar; o máximo é dois: o botão trava e a frase diz por quê.
    expect((await db().select().from(nichos).where(eq(nichos.id, advocacia)))[0].ativo).toBe(true);
    await expect(bloco.getByRole("button", { name: "ligar outro ramo" })).toBeDisabled();
    await expect(bloco.getByText("A marca já tem dois ramos alternativos; tire um antes de ligar outro.")).toBeVisible();

    // Tirar o único uso do setor o desliga (o setor de Nutrição, que não é de ninguém mais neste teste, também).
    const linhaAdvocacia = bloco.locator("[data-ramo-alternativo]").filter({ hasText: "Advocacia" });
    await linhaAdvocacia.getByRole("button", { name: "tirar" }).click();
    await expect(bloco.locator("[data-ramo-alternativo]")).toHaveCount(1);
    await expect.poll(async () => (await db().select().from(nichos).where(eq(nichos.id, advocacia)))[0].ativo).toBe(false);
    await expect(bloco.getByRole("button", { name: "ligar outro ramo" })).toBeEnabled();
    expect(nutricao).toBeGreaterThan(0);
  });
});

test.describe("ramos alternativos: o que o cliente vê", () => {
  test("Referências mostra os vídeos dos dois ramos, a pílula Ramo filtra, e a Conta diz quais ramos o admin ligou", async ({ page }) => {
    const marca = await criarMarca("e2e-ramos-ref", "e2e-ramos-ref@exemplo.teste", "[teste] Ramos Referencias", "e2e-ramos-ref-principal", { comBriefing: true });
    await semAlternativos(marca.id);
    const nutricao = await setorDoCatalogo("nutricao");
    await db().insert(ramosDaConta).values({ clienteId: marca.id, nichoId: nutricao });
    const contaPrincipal = await contaDoSetor("@e2e-ramos-ref-principal", marca.nichoId!);
    const contaNutricao = await contaDoSetor("@e2e-ramos-ref-nutricao", nutricao);
    await semearVideo("e2e-ramos-ref-p", marca.nichoId!, contaPrincipal, "dica do ramo principal da marca");
    await semearVideo("e2e-ramos-ref-n", nutricao, contaNutricao, "dica do ramo de nutrição da marca");

    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, "e2e-ramos-ref@exemplo.teste");
    await page.goto("/referencias?periodo=90&plataforma=todas");

    await expect(page.getByText("dica do ramo principal da marca").first()).toBeVisible();
    await expect(page.getByText("dica do ramo de nutrição da marca").first()).toBeVisible();
    // O cartão do vídeo de um ramo alternativo mostra o nome do ramo; o do principal não.
    await expect(page.locator("[data-selo-ramo]")).toHaveCount(1);
    await expect(page.locator("[data-selo-ramo]").first()).toHaveText("Nutrição");

    await page.locator("[data-pilula-ramo]").getByRole("button", { name: "Ramo" }).click();
    await page.getByRole("menuitemradio", { name: "Nutrição" }).click();
    await expect(page).toHaveURL(new RegExp(`ramo=${nutricao}`));
    await expect(page.getByText("dica do ramo de nutrição da marca").first()).toBeVisible();
    await expect(page.getByText("dica do ramo principal da marca")).toHaveCount(0);

    await page.locator("[data-pilula-ramo]").getByRole("button", { name: "Nutrição" }).click();
    await page.getByRole("menuitemradio", { name: "Todos os ramos" }).click();
    await expect(page.getByText("dica do ramo principal da marca").first()).toBeVisible();

    // A Conta só lê: a frase diz o ramo que o admin ligou, sem botão para ligar ou tirar.
    await page.goto("/conta");
    await expect(page.locator("[data-ramos-alternativos-conta]")).toHaveText("A gente ligou também Nutrição aos seus temas e referências.");
  });

  test("tema livre: o assunto que só o ramo alternativo tem prova recebe a prova daquele ramo, e sem o alternativo não", async ({ page }) => {
    const marca = await criarMarca("e2e-ramos-tema", "e2e-ramos-tema@exemplo.teste", "[teste] Ramos Tema", "e2e-ramos-tema-principal", { comBriefing: true });
    await semAlternativos(marca.id);
    const nutricao = await setorDoCatalogo("nutricao");
    const contaA = await contaDoSetor("@e2e-ramos-tema-a", nutricao);
    const contaB = await contaDoSetor("@e2e-ramos-tema-b", nutricao);
    const titulo = "como montar um cardapio de marmita para a semana";
    await semearVideo("e2e-ramos-tema-1", nutricao, contaA, titulo);
    await semearVideo("e2e-ramos-tema-2", nutricao, contaB, titulo);
    await semearVideo("e2e-ramos-tema-3", nutricao, contaA, titulo);

    await entrar(page, "e2e-ramos-tema@exemplo.teste");

    // Sem o alternativo ligado, o assunto não tem prova nenhuma no ramo principal.
    await page.goto("/criar/tema-livre");
    await page.getByLabel("Sobre o que você quer falar?").fill("como montar um cardapio de marmita para a semana");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Dá para melhorar esse tema" })).toBeVisible();
    await expect(page.getByText("O ângulo mais próximo que tem evidência")).not.toBeVisible();

    // Com o alternativo ligado pelo admin, a prova vem do ramo de Nutrição.
    await db().insert(ramosDaConta).values({ clienteId: marca.id, nichoId: nutricao });
    await page.goto("/criar/tema-livre");
    await page.getByLabel("Sobre o que você quer falar?").fill("como montar um cardapio de marmita para a semana");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByText("O ângulo mais próximo que tem evidência")).toBeVisible();
  });
});
