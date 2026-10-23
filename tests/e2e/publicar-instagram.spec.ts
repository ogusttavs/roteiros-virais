/**
 * E56 PR 1, publicar no Instagram pelo aplicativo, pela tela do roteiro, pelo servidor de verdade e contra a Meta SIMULADA (`tests/fixtures/meta-simulada.ts`: diálogo, Graph API e envio de vídeo
 * locais; nunca a Meta de verdade). Prova, pelo que a pessoa vê: a folha com a legenda do roteiro já preenchida, o Reels do começo ao post publicado (o vídeo chega à Meta com o tamanho certo, o
 * "postei" vira automático e o botão da barra vira "Postado"), o Story sem legenda, o vídeo recusado pela Meta, o formato errado, a conta ligada sem a publicação liberada e quem é só membro.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contasConectadas, membrosMarca, nichos, preferenciasUsuario, publicacoes, roteiros, user, videosCliente, type ConteudoRoteiro } from "../../src/db/schema";
import { textosPublicar } from "../../src/textos/publicar";
import { CONTA_PADRAO, iniciarMetaSimulada, TOKEN_LONGO_SIMULADO, type MetaSimulada } from "../fixtures/meta-simulada";

const SENHA = "ExemploSenha123";
const DONO = "e2e-publicar-dono";
const DONO_EMAIL = "dono-e2e-publicar@exemplo.teste";
const MEMBRO = "e2e-publicar-membro";
const MEMBRO_EMAIL = "membro-e2e-publicar@exemplo.teste";
const t = textosPublicar.tela;

let meta: MetaSimulada;
let marca: number;

const CONTEUDO: ConteudoRoteiro = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 30,
  gancho: "O terceiro erro é o que mais estraga o copo.",
  corpo: "Quase sempre sobra detergente no fundo.",
  fechamento: "Enxágue sempre com água morna.",
  chamadaFinal: "Chame no WhatsApp e peça o seu orçamento.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na sua cozinha",
  edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|comecar)/);
}

async function criarPessoa(id: string, email: string, nome: string): Promise<void> {
  await db().delete(user).where(eq(user.id, id));
  await db().insert(user).values({ id, name: nome, email });
  await db().insert(account).values({ id: `${id}-c`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
}

async function novoRoteiro(tema: string, extra: Partial<typeof roteiros.$inferInsert> = {}): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId: marca, data: "2026-10-23", tema, origem: "livre", objetivo: "alcance", formato: "reels", estilo: "falado", conteudo: CONTEUDO, ...extra })
    .returning({ id: roteiros.id });
  return linha.id;
}

/** Liga a conta pelo caminho de verdade (botão, diálogo da Meta simulada, volta). */
async function ligarInstagram(page: Page): Promise<void> {
  await page.goto("/api/meta/conectar");
  await expect(page.getByTestId("seu-instagram")).toHaveAttribute("data-estado", "ligada");
}

async function abrirFolhaDePublicar(page: Page, roteiroId: number): Promise<void> {
  await page.goto(`/roteiros/${roteiroId}`);
  await page.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: t.abrir }).click();
  await expect(page.getByRole("heading", { name: t.titulo })).toBeVisible();
}

const VIDEO = { name: "meu-video.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 7) };

test.describe("Publicar no Instagram, no roteiro", () => {
  test.beforeAll(async () => {
    meta = await iniciarMetaSimulada(Number(process.env.PLAYWRIGHT_META_PORTA ?? 4747));
    const [nicho] = await db().select().from(nichos).limit(1);
    await criarPessoa(DONO, DONO_EMAIL, "Dona Publicar E2E");
    await criarPessoa(MEMBRO, MEMBRO_EMAIL, "Membro Publicar E2E");
    const [c] = await db().insert(clientes).values({ nome: "[teste e2e] Marca que publica", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" }).returning();
    marca = c.id;
    await db().insert(membrosMarca).values([
      { usuarioId: DONO, clienteId: marca, papel: "dono" },
      { usuarioId: MEMBRO, clienteId: marca, papel: "membro" },
    ]);
    await db().insert(briefings).values({ clienteId: marca, completo: true });
  });

  test.afterAll(async () => {
    await db().delete(publicacoes).where(eq(publicacoes.clienteId, marca));
    await db().delete(videosCliente).where(eq(videosCliente.clienteId, marca));
    await db().delete(roteiros).where(eq(roteiros.clienteId, marca));
    await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marca));
    await meta.fechar();
  });

  test.beforeEach(async () => {
    await db().delete(publicacoes).where(eq(publicacoes.clienteId, marca));
    await db().delete(videosCliente).where(eq(videosCliente.clienteId, marca));
    await db().delete(roteiros).where(eq(roteiros.clienteId, marca));
    await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marca));
    meta.cenario = {};
    meta.chamadas.length = 0;
  });

  test("Reels do começo ao fim: a legenda do roteiro vem preenchida, o vídeo chega à Meta inteiro, o post sai e o postei vira automático", async ({ page }) => {
    const id = await novoRoteiro("louça");
    await entrar(page, DONO_EMAIL);
    await ligarInstagram(page);
    await expect(page.getByTestId("seu-instagram").locator("[data-parte='publicar']")).toHaveAttribute("data-publicar", "liberada");

    await abrirFolhaDePublicar(page, id);
    const folha = page.locator("[data-parte='formulario']");
    await expect(folha).toContainText(t.sai(CONTA_PADRAO.username));
    // Reels já marcado (o roteiro é Reels) e a legenda do roteiro já preenchida.
    await expect(folha.getByRole("button", { name: t.reels, pressed: true })).toBeVisible();
    const legenda = folha.getByLabel(t.legenda);
    await expect(legenda).toHaveValue(`${CONTEUDO.titulo}\n\n${CONTEUDO.chamadaFinal}`);
    await legenda.fill("Minha legenda editada #louça");
    await expect(folha.getByRole("button", { name: t.publicar })).toBeDisabled();

    await folha.locator("input[type=file]").setInputFiles(VIDEO);
    await expect(folha).toContainText("meu-video.mp4");
    await folha.getByRole("button", { name: t.publicar }).click();

    await expect(page.getByText(t.publicada)).toBeVisible({ timeout: 30_000 });
    const ver = page.getByRole("link", { name: t.verNoInstagram });
    await expect(ver).toHaveAttribute("href", "https://www.instagram.com/reel/SIMULADOe2e/");

    // O que a Meta recebeu: o contêiner retomável de Reels com a legenda editada, o vídeo inteiro (2048 bytes) e a publicação.
    const contêiner = meta.chamadas.find((x) => x.metodo === "POST" && x.caminho.endsWith("/media"));
    expect(contêiner?.parametros).toMatchObject({ media_type: "REELS", upload_type: "resumable", caption: "Minha legenda editada #louça", share_to_feed: "true" });
    const envio = meta.chamadas.find((x) => x.caminho.startsWith("/rupload/"));
    expect(envio).toMatchObject({ bytes: 2048, parametros: { offset: "0", file_size: "2048" } });
    expect(meta.chamadas.filter((x) => x.caminho.endsWith("/media_publish"))).toHaveLength(1);

    // No banco: publicada, o roteiro postado com o link, e o vídeo na curva com a mídia da Meta.
    const [p] = await db().select().from(publicacoes).where(eq(publicacoes.clienteId, marca));
    expect(p).toMatchObject({ estado: "publicada", tipo: "reels", legenda: "Minha legenda editada #louça", permalink: "https://www.instagram.com/reel/SIMULADOe2e/", midiaId: "midia-simulada-1" });
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(roteiro).toMatchObject({ status: "postado", urlPostado: "https://www.instagram.com/reel/SIMULADOe2e/" });
    const [video] = await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, id));
    expect(video).toMatchObject({ plataforma: "instagram", idExterno: "SIMULADOe2e", metaMediaId: "midia-simulada-1" });

    // A tela, ao recarregar, mostra o roteiro como postado, e o acesso da Meta nunca esteve na página.
    await page.goto(`/roteiros/${id}`);
    await expect(page.getByRole("link", { name: "Postado" })).toHaveAttribute("href", "https://www.instagram.com/reel/SIMULADOe2e/");
    expect(await page.content()).not.toContain(TOKEN_LONGO_SIMULADO);
  });

  test("Story: a escolha tira o campo da legenda e a Meta recebe um Story sem legenda", async ({ page }) => {
    const id = await novoRoteiro("louça story", { formato: "story", conteudo: { ...CONTEUDO, cartoes: [{ oQueFalar: "Erro um", oQueMostrar: "A pia", textoNaTela: "Erro um", figurinha: "nenhuma" }] } });
    await entrar(page, DONO_EMAIL);
    await ligarInstagram(page);
    await abrirFolhaDePublicar(page, id);
    const folha = page.locator("[data-parte='formulario']");
    await expect(folha.getByRole("button", { name: t.story, pressed: true })).toBeVisible();
    await expect(folha.getByLabel(t.legenda)).toHaveCount(0);
    await expect(folha).toContainText("O Story não leva legenda");

    await folha.locator("input[type=file]").setInputFiles(VIDEO);
    await folha.getByRole("button", { name: t.publicar }).click();
    await expect(page.getByText(t.publicada)).toBeVisible({ timeout: 30_000 });
    const contêiner = meta.chamadas.find((x) => x.metodo === "POST" && x.caminho.endsWith("/media"));
    expect(contêiner?.parametros.media_type).toBe("STORIES");
    expect(contêiner?.parametros).not.toHaveProperty("caption");
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(roteiro.status).toBe("postado");
  });

  test("a Meta recusa o vídeo: a folha diz o motivo em língua de gente, o roteiro segue sem postar e dá para tentar de novo", async ({ page }) => {
    const id = await novoRoteiro("louça recusada");
    await entrar(page, DONO_EMAIL);
    await ligarInstagram(page);
    meta.cenario = { erroNaPublicacao: "envio" };
    await abrirFolhaDePublicar(page, id);
    const folha = page.locator("[data-parte='formulario']");
    await folha.locator("input[type=file]").setInputFiles(VIDEO);
    await folha.getByRole("button", { name: t.publicar }).click();

    const alerta = page.getByRole("alert").filter({ hasText: "O Instagram não conseguiu preparar o vídeo" });
    await expect(alerta).toBeVisible({ timeout: 30_000 });
    await expect(alerta).not.toContainText("352");
    await expect(page.getByRole("button", { name: t.tentarDeNovo })).toBeVisible();
    const [p] = await db().select().from(publicacoes).where(eq(publicacoes.clienteId, marca));
    expect(p.estado).toBe("falhou");
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(roteiro.status).toBe("gerado");

    // Tentar de novo, agora com a Meta aceitando: publica.
    meta.cenario = {};
    await page.getByRole("button", { name: t.tentarDeNovo }).click();
    await expect(page.getByText(t.publicada)).toBeVisible({ timeout: 30_000 });
  });

  test("um arquivo que não é MP4 nem MOV é recusado na folha, antes de qualquer envio", async ({ page }) => {
    const id = await novoRoteiro("louça formato");
    await entrar(page, DONO_EMAIL);
    await ligarInstagram(page);
    await abrirFolhaDePublicar(page, id);
    const folha = page.locator("[data-parte='formulario']");
    await folha.locator("input[type=file]").setInputFiles({ name: "anotacoes.txt", mimeType: "text/plain", buffer: Buffer.from("oi") });
    await expect(folha.getByRole("alert")).toContainText("Escolha um vídeo no formato MP4 ou MOV.");
    await expect(folha.getByRole("button", { name: t.publicar })).toBeDisabled();
    expect(meta.chamadas.some((x) => x.caminho.endsWith("/media"))).toBe(false);
  });

  test("conta ligada sem a publicação liberada: a Conta avisa e a folha manda ligar de novo", async ({ page }) => {
    const id = await novoRoteiro("louça sem permissão");
    await entrar(page, DONO_EMAIL);
    meta.cenario = { permissoesLiberadas: ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"] };
    await ligarInstagram(page);
    await expect(page.getByTestId("seu-instagram").locator("[data-parte='publicar']")).toHaveAttribute("data-publicar", "falta");
    await expect(page.getByTestId("seu-instagram").getByRole("link", { name: "Ligar de novo" })).toBeVisible();

    await page.goto(`/roteiros/${id}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: t.abrir }).click();
    const folha = page.locator("[data-parte='sem-condicao']");
    await expect(folha).toHaveAttribute("data-motivo", "sem-permissao");
    await expect(folha.getByRole("link", { name: t.irParaConta })).toHaveAttribute("href", "/conta");
    expect(meta.chamadas.some((x) => x.caminho.endsWith("/media"))).toBe(false);
  });

  test("sem Instagram ligado a folha explica o caminho; quem é só membro da marca nem vê a opção", async ({ page, browser }, testInfo) => {
    const id = await novoRoteiro("louça sem conta");
    await entrar(page, DONO_EMAIL);
    await abrirFolhaDePublicar(page, id);
    await expect(page.locator("[data-parte='sem-condicao']")).toHaveAttribute("data-motivo", "sem-conta");

    const contexto = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), timezoneId: "America/Sao_Paulo" });
    const outro = await contexto.newPage();
    await entrar(outro, MEMBRO_EMAIL);
    await outro.goto(`/roteiros/${id}`);
    await outro.getByRole("button", { name: "Mais opções" }).click();
    await expect(outro.getByRole("menuitem", { name: "Copiar o texto do roteiro" })).toBeVisible();
    await expect(outro.getByRole("menuitem", { name: t.abrir })).toHaveCount(0);
    await contexto.close();
  });
});
