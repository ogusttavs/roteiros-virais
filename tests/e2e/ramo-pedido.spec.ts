/**
 * E45, PR 2: o "Não achei o meu" e o ramo provisório, de ponta a ponta.
 *
 * - Começar: a pessoa escreve "criação de abelhas", escolhe "Não achei o meu", vê onde vai ficar enquanto a gente confere, e a marca entra
 *   no ramo mais parecido (Agro e campo) com o pedido aberto, que aparece no admin, com o número ao lado de "Nichos".
 * - Conta: a mesma saída, o aviso, e a frase "o seu ramo ainda está sendo pesquisado" em Criar temas (um ramo sem vídeo nenhum).
 * - Admin: "encaixar em um que existe" leva a marca ao setor do ramo escolhido e fecha o pedido; "criar ramo" abre o novo nicho já preenchido,
 *   cria o setor, leva a marca e fecha o pedido. Nunca setor novo sozinho; o provisório desliga se ficou sem marca.
 *
 * Seguro para a repetição automática do Playwright (F1, item 4): cada teste começa pondo a marca dele no estado de partida, sem depender de
 * outro teste. As marcas e os setores de partida têm ids e nomes próprios.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, pedidosDeRamo, preferenciasUsuario, user } from "../../src/db/schema";
import { textosHoje } from "../../src/textos/hoje";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const TEXTO_ABELHAS = "criação de abelhas";

const EMAIL_COMECAR = "e2e-pedido-comecar@exemplo.teste";
const EMAIL_CONTA = "e2e-pedido-conta@exemplo.teste";
const EMAIL_ENCAIXAR = "e2e-pedido-encaixar@exemplo.teste";
const EMAIL_CRIAR = "e2e-pedido-criar@exemplo.teste";

const NOME_COMECAR = "[teste] Pedido Começar";
const NOME_CONTA = "[teste] Pedido Conta";
const NOME_ENCAIXAR = "[teste] Pedido Encaixar";
const NOME_CRIAR = "[teste] Pedido Criar";

const TEXTO_ENCAIXAR = "conserto de violinos antigos";
const TEXTO_CRIAR = "fabricação de velas artesanais";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

async function criarUsuario(usuarioId: string, email: string, nome: string, opcoes: { nichoId?: number; completa?: boolean } = {}) {
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
  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome,
      nichoId: opcoes.nichoId,
      tipo: "negocio",
      persona: "negocio",
      alcance: opcoes.completa ? "brasil" : undefined,
    })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  if (opcoes.completa) {
    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "peças feitas à mão",
            preco: "a partir de 80 reais",
            clienteIdeal: "quem gosta de coisa artesanal",
            medos: [],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: [],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "faz peças artesanais sob encomenda",
          referencias: [],
        },
      });
  }
  return cliente.id;
}

async function marcaDe(usuarioId: string) {
  const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, usuarioId));
  return marca;
}

async function pedidosDa(clienteId: number) {
  return db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.clienteId, clienteId));
}

/** Põe a marca no estado de partida: sem pedido nenhum e no setor dado (ou sem setor). */
async function voltarAoInicio(usuarioId: string, nichoId: number | null, opcoes: { semDadosFixos?: boolean } = {}) {
  const marca = await marcaDe(usuarioId);
  await db().delete(pedidosDeRamo).where(eq(pedidosDeRamo.clienteId, marca.id));
  await db()
    .update(clientes)
    .set({ nichoId, ramoOutro: null, ...(opcoes.semDadosFixos ? { alcance: null } : {}) })
    .where(eq(clientes.id, marca.id));
  return marca.id;
}

/** O admin com um pedido aberto para a marca, no setor provisório dado (o que o "Não achei o meu" deixaria), para os testes da tela do admin. */
async function semearPedidoAberto(usuarioId: string, texto: string, provisorioId: number) {
  const clienteId = await voltarAoInicio(usuarioId, provisorioId);
  await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, provisorioId));
  await db().update(clientes).set({ ramoOutro: texto }).where(eq(clientes.id, clienteId));
  await db().insert(pedidosDeRamo).values({ clienteId, texto, setorProvisorioId: provisorioId, estado: "aberto" });
  return clienteId;
}

async function entrarComoAdmin(page: Page) {
  await entrar(page, EMAIL_ADMIN);
  await expect(page).toHaveURL(/\/admin\/clientes/);
}

function linhaDoPedido(page: Page, nomeDaMarca: string) {
  return page.locator("[data-pedido-de-ramo]").filter({ hasText: nomeDaMarca });
}

test.describe("E45 PR 2: Não achei o meu e o ramo provisório", () => {
  let partidaId: number;
  let provisorioEncaixarId: number;
  let provisorioCriarId: number;

  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-pedido-conta"));
    if (jaExiste) {
      const setores = await db().select().from(nichos);
      partidaId = setores.find((s) => s.slug === "e2e-pedido-partida")!.id;
      provisorioEncaixarId = setores.find((s) => s.slug === "e2e-pedido-prov-encaixar")!.id;
      provisorioCriarId = setores.find((s) => s.slug === "e2e-pedido-prov-criar")!.id;
      return;
    }

    // Nichos sem vídeo nenhum: o de partida da marca da Conta (feito à mão, sem ramo do catálogo), e um provisório para cada marca do admin. Os
    // provisórios nascem de ramos do catálogo, como o palpite do "Não achei o meu" os faz nascer: só setor que nasceu do catálogo desliga ao ficar sem marca.
    const [partida] = await db().insert(nichos).values({ slug: "e2e-pedido-partida", nome: "[teste] Partida do pedido" }).returning();
    const [provEncaixar] = await db()
      .insert(nichos)
      .values({ slug: "e2e-pedido-prov-encaixar", nome: "[teste] Provisório do encaixe", ramoCatalogo: "psicologia-e-terapias" })
      .returning();
    const [provCriar] = await db()
      .insert(nichos)
      .values({ slug: "e2e-pedido-prov-criar", nome: "[teste] Provisório da criação", ramoCatalogo: "fotografia-e-video" })
      .returning();
    partidaId = partida.id;
    provisorioEncaixarId = provEncaixar.id;
    provisorioCriarId = provCriar.id;

    await criarUsuario("e2e-pedido-comecar", EMAIL_COMECAR, NOME_COMECAR);
    await criarUsuario("e2e-pedido-conta", EMAIL_CONTA, NOME_CONTA, { nichoId: partida.id, completa: true });
    await criarUsuario("e2e-pedido-encaixar", EMAIL_ENCAIXAR, NOME_ENCAIXAR, { nichoId: provEncaixar.id, completa: true });
    await criarUsuario("e2e-pedido-criar", EMAIL_CRIAR, NOME_CRIAR, { nichoId: provCriar.id, completa: true });
  });

  test("Começar: 'criação de abelhas' vira pedido, a marca espera em Agro e campo, e o pedido aparece no admin com o número ao lado de Nichos", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    await voltarAoInicio("e2e-pedido-comecar", null, { semDadosFixos: true });

    await entrar(page, EMAIL_COMECAR);
    await expect(page).toHaveURL(/\/comecar/);
    await page.getByRole("button", { name: "Começar", exact: true }).click();

    const campo = page.getByRole("combobox", { name: "Ramo" });
    await campo.fill(TEXTO_ABELHAS);
    // O catálogo já tem um ramo que serve de palpite (Agro e campo), e mesmo assim a saída está na lista: a pessoa decide.
    const naoAchei = page.getByRole("option", { name: /Não achei o meu/ });
    await expect(naoAchei).toBeVisible();
    await naoAchei.click();

    const textoLivre = page.getByLabel("Qual é o seu ramo");
    await expect(textoLivre).toHaveValue(TEXTO_ABELHAS);
    // Antes de continuar, a pessoa vê onde vai ficar enquanto a gente confere.
    await expect(page.locator("[data-aviso-ramo-provisorio]")).toHaveText("Você está em Agro e campo enquanto a gente confere o seu ramo.");

    await page.getByRole("radio", { name: "No Brasil inteiro" }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sobre o negócio" })).toBeVisible();

    const marca = await marcaDe("e2e-pedido-comecar");
    const [agro] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "agro-e-campo"));
    expect(agro, "o setor do ramo provisório devia ter nascido").toBeTruthy();
    expect(marca.nichoId).toBe(agro.id);
    expect(marca.ramoOutro).toBe(TEXTO_ABELHAS);
    const pedidos = await pedidosDa(marca.id);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ texto: TEXTO_ABELHAS, estado: "aberto", setorProvisorioId: agro.id });

    // Quem administra vê o pedido na página de Nichos, e o número ao lado da aba.
    const contextoAdmin = await browser.newContext();
    const admin = await contextoAdmin.newPage();
    await entrarComoAdmin(admin);
    await expect(admin.getByRole("img", { name: /pedidos? de ramo abertos?/ })).toBeVisible();
    await admin.goto("/admin/nichos");
    await expect(admin.getByRole("heading", { name: "Pedidos de ramo" })).toBeVisible();
    const linha = linhaDoPedido(admin, NOME_COMECAR);
    await expect(linha).toContainText(TEXTO_ABELHAS);
    await expect(linha).toContainText("espera em Agro e campo");
    await expect(linha.getByRole("button", { name: "encaixar em um que existe" })).toBeVisible();
    await expect(linha.getByRole("button", { name: "criar ramo" })).toBeVisible();
    await contextoAdmin.close();
  });

  test("Conta: 'Não achei o meu' põe a marca num ramo provisório com o aviso, e Criar temas diz que o ramo ainda está sendo pesquisado", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await voltarAoInicio("e2e-pedido-conta", partidaId);

    await entrar(page, EMAIL_CONTA);
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/conta");

    const campo = page.getByRole("combobox", { name: "ramo" });
    await campo.fill(TEXTO_ABELHAS);
    await page.getByRole("option", { name: /Não achei o meu/ }).click();
    await expect(page.getByLabel("Qual é o seu ramo")).toHaveValue(TEXTO_ABELHAS);

    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo")).toBeVisible();
    await expect(page.getByText("Você está em Agro e campo enquanto a gente confere o seu ramo.")).toBeVisible();

    const marca = await marcaDe("e2e-pedido-conta");
    const [agro] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "agro-e-campo"));
    expect(marca.nichoId).toBe(agro.id);
    expect(marca.ramoOutro).toBe(TEXTO_ABELHAS);
    expect(await pedidosDa(marca.id)).toHaveLength(1);

    // Recarregar mostra o mesmo estado: o campo diz "Não achei o meu", com o texto e o aviso.
    await page.reload();
    await expect(page.getByRole("combobox", { name: "ramo" })).toHaveValue("Não achei o meu");
    await expect(page.getByLabel("Qual é o seu ramo")).toHaveValue(TEXTO_ABELHAS);
    await expect(page.getByText("Você está em Agro e campo enquanto a gente confere o seu ramo.")).toBeVisible();

    // O ramo recém-criado não tem vídeo nenhum: a tela de temas diz isso em vez de "hoje não saiu tema".
    await page.goto("/criar/temas");
    await expect(page.getByText(textosHoje.ramoNovoTitulo)).toBeVisible();
    await expect(page.getByText(textosHoje.ramoNovo, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Escrever o meu assunto" })).toBeVisible();
  });

  test("admin: 'encaixar em um que existe' leva a marca ao ramo escolhido, fecha o pedido e desliga o provisório que ficou sem marca", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await semearPedidoAberto("e2e-pedido-encaixar", TEXTO_ENCAIXAR, provisorioEncaixarId);

    await entrarComoAdmin(page);
    await page.goto("/admin/nichos");
    const linha = linhaDoPedido(page, NOME_ENCAIXAR);
    await expect(linha).toContainText(TEXTO_ENCAIXAR);
    await expect(linha).toContainText("espera em [teste] Provisório do encaixe");

    await linha.getByRole("button", { name: "encaixar em um que existe" }).click();
    const busca = linha.getByRole("combobox", { name: /^Encaixar/ });
    await busca.fill("dentista");
    await busca.press("Enter");
    const confirmar = linha.getByRole("button", { name: "encaixar em Odontologia" });
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    await expect(linhaDoPedido(page, NOME_ENCAIXAR)).toHaveCount(0);

    const marca = await marcaDe("e2e-pedido-encaixar");
    const [dentistas] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
    expect(marca.nichoId).toBe(dentistas.id);
    expect(marca.ramoOutro).toBeNull();
    const [pedido] = await pedidosDa(marca.id);
    expect(pedido).toMatchObject({ estado: "atendido", resolucao: "encaixado", setorFinalId: dentistas.id });
    const [provisorio] = await db().select().from(nichos).where(eq(nichos.id, provisorioEncaixarId));
    expect(provisorio.ativo, "o setor provisório ficou sem marca e devia desligar").toBe(false);
  });

  test("admin: 'criar ramo' abre o novo nicho já preenchido, cria o setor, leva a marca e fecha o pedido (nunca setor novo sozinho)", async ({ page }) => {
    test.setTimeout(60_000);
    await semearPedidoAberto("e2e-pedido-criar", TEXTO_CRIAR, provisorioCriarId);
    const nomeDoRamo = "Fabricação de velas artesanais";
    // Numa repetição automática o setor da primeira passada já existe, e a marca já voltou ao provisório: sai do caminho (sem marca nem pedido nele).
    await db().delete(nichos).where(eq(nichos.nome, nomeDoRamo));
    // Antes de o admin decidir, o setor não existe: o pedido sozinho nunca cria setor.
    expect(await db().select().from(nichos).where(eq(nichos.nome, nomeDoRamo))).toHaveLength(0);

    await entrarComoAdmin(page);
    await page.goto("/admin/nichos");
    await linhaDoPedido(page, NOME_CRIAR).getByRole("button", { name: "criar ramo" }).click();

    const modal = page.getByRole("dialog", { name: "Criar ramo para o pedido" });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(`Pedido de ${NOME_CRIAR}: “${TEXTO_CRIAR}”.`);
    await expect(modal.getByLabel("nome", { exact: true })).toHaveValue(nomeDoRamo);
    await modal.getByLabel("descrição curta").fill("[exemplo e2e] ramo criado a partir de um pedido");
    await modal.getByLabel("termos de busca").fill("vela artesanal\nvela aromática\nvela decorativa\naroma para casa\nvelas de soja");
    await modal.getByRole("button", { name: "criar ramo e mover a marca" }).click();

    await expect(page.getByRole("link", { name: nomeDoRamo })).toBeVisible();
    await expect(linhaDoPedido(page, NOME_CRIAR)).toHaveCount(0);

    const [novo] = await db().select().from(nichos).where(eq(nichos.nome, nomeDoRamo));
    expect(novo, "o setor devia ter nascido ao salvar").toBeTruthy();
    const marca = await marcaDe("e2e-pedido-criar");
    expect(marca.nichoId).toBe(novo.id);
    expect(marca.ramoOutro).toBeNull();
    const pedidos = await db()
      .select()
      .from(pedidosDeRamo)
      .where(and(eq(pedidosDeRamo.clienteId, marca.id), eq(pedidosDeRamo.estado, "atendido")));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ resolucao: "ramo_criado", setorFinalId: novo.id });
    const [provisorio] = await db().select().from(nichos).where(eq(nichos.id, provisorioCriarId));
    expect(provisorio.ativo, "o setor provisório ficou sem marca e devia desligar").toBe(false);
  });
});
