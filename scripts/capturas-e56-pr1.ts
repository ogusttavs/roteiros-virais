/**
 * Capturas da E56 PR 1 ("Publicar no Instagram", a folha do roteiro e a linha nova do cartão "Seu Instagram"), cada estado, em 390 e 1280, claro e escuro. A Meta é SIMULADA
 * (`tests/fixtures/meta-simulada.ts`): este script sobe o servidor local que faz o papel do diálogo, da Graph API e do envio de vídeo, e o aplicativo só fala com ele porque está de pé com
 * `MODO_E2E=1` e `META_SIMULADOR_E2E`. Nenhuma chamada à Meta de verdade. Nenhum dado de cliente: as pessoas, a marca e os roteiros são criados aqui, com e-mail `.teste`, no banco apontado por
 * `DATABASE_URL`.
 *
 * Pré-requisitos: `DATABASE_URL` de um banco de revisão (nunca `roteiros`), migrado e semeado (o `globalSetup` do Playwright faz isso); o app no ar em `CAPTURAS_URL` com o mesmo ambiente do
 * `webServer.env` do `playwright.config.ts` (MODO_E2E, META_*).
 *
 * Uso: `npx tsx scripts/capturas-e56-pr1.ts <pasta-de-saida>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { account, briefings, clientes, contasConectadas, membrosMarca, nichos, preferenciasUsuario, publicacoes, roteiros, user, videosCliente, type ConteudoRoteiro } from "../src/db/schema";
import { textosPublicar } from "../src/textos/publicar";
import { iniciarMetaSimulada, type MetaSimulada } from "../tests/fixtures/meta-simulada";

const BASE = process.env.CAPTURAS_URL ?? "http://localhost:3100";
const SENHA = "ExemploSenha123";
const DONO = "cap-e56-dono";
const t = textosPublicar.tela;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "claro", colorScheme: "light" as const },
  { rotulo: "escuro", colorScheme: "dark" as const },
];

const CONTEUDO: ConteudoRoteiro = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 30,
  gancho: "O terceiro erro é o que mais estraga o copo.",
  corpo: "Quase sempre sobra detergente no fundo. Enxágue com água morna.",
  fechamento: "Faça isso por uma semana e veja a diferença.",
  chamadaFinal: "Chame no WhatsApp e peça o seu orçamento.",
  cartoes: null,
  porQueAssim: [],
  cenas: [{ momento: "0 a 3 s", oQueFazer: "Mostre o copo embaçado perto da câmera." }],
  ondeGravar: "na sua cozinha, com a pia aparecendo",
  edicao: { textoNaTela: [{ quando: "0 s", oQue: "O erro que estraga o copo", onde: "no alto" }], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

let marca: number;
let roteiroId: number;

async function prepararMarca(): Promise<void> {
  const email = `${DONO}@exemplo.teste`;
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  const [existe] = await db().select({ id: user.id }).from(user).where(eq(user.id, DONO));
  if (!existe) {
    await db().insert(user).values({ id: DONO, name: "[exemplo] Dona que publica", email, role: "cliente" });
    await db().insert(account).values({ id: `${DONO}-credential`, issuer: "local:credential", accountId: DONO, providerId: "credential", userId: DONO, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: DONO, aceitouTermosEm: new Date() });
  }
  const [antiga] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.nome, "[exemplo] Capturas E56"));
  if (antiga) {
    marca = antiga.id;
  } else {
    const [c] = await db().insert(clientes).values({ nome: "[exemplo] Capturas E56", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" }).returning();
    marca = c.id;
    await db().insert(membrosMarca).values({ usuarioId: DONO, clienteId: marca, papel: "dono" });
    await db().insert(briefings).values({ clienteId: marca, completo: true });
  }
}

async function zerar(): Promise<void> {
  await db().delete(publicacoes).where(eq(publicacoes.clienteId, marca));
  await db().delete(videosCliente).where(eq(videosCliente.clienteId, marca));
  await db().delete(roteiros).where(eq(roteiros.clienteId, marca));
  await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marca));
  const [r] = await db()
    .insert(roteiros)
    .values({ clienteId: marca, data: "2026-10-23", tema: "louça", origem: "livre", objetivo: "alcance", formato: "reels", estilo: "falado", conteudo: CONTEUDO })
    .returning({ id: roteiros.id });
  roteiroId = r.id;
}

async function entrar(page: Page): Promise<void> {
  await page.goto(`${BASE}/entrar`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(`${DONO}@exemplo.teste`);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/(hoje|comecar)/);
  await page.waitForLoadState("networkidle");
}

async function ligarInstagram(page: Page): Promise<void> {
  await page.goto(`${BASE}/api/meta/conectar`);
  await page.getByTestId("seu-instagram").waitFor();
  await page.waitForLoadState("networkidle");
}

async function abrirRoteiro(page: Page): Promise<void> {
  await page.goto(`${BASE}/roteiros/${roteiroId}`);
  await page.getByRole("button", { name: "Mais opções" }).waitFor();
  await page.waitForLoadState("networkidle");
}

async function abrirMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: t.abrir }).waitFor();
  await page.waitForTimeout(500);
}

async function abrirFolha(page: Page): Promise<void> {
  await abrirMenu(page);
  await page.getByRole("menuitem", { name: t.abrir }).click();
  await page.getByRole("heading", { name: t.titulo }).waitFor();
  await page.waitForTimeout(600);
}

async function foto(page: Page, saida: string, nome: string, sufixo: string): Promise<void> {
  await page.screenshot({ path: path.join(saida, `${nome}-${sufixo}.png`) });
}

// 3 MB: o suficiente para a barra de andamento mostrar um número antes de a resposta chegar.
const VIDEO = { name: "meu-video.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(3 * 1024 * 1024, 7) };

async function main(): Promise<void> {
  const saida = process.argv[2];
  if (!saida) {
    console.error("uso: npx tsx scripts/capturas-e56-pr1.ts <pasta-de-saida>");
    process.exitCode = 1;
    return;
  }
  await mkdir(saida, { recursive: true });
  await prepararMarca();
  const meta: MetaSimulada = await iniciarMetaSimulada(Number(process.env.PLAYWRIGHT_META_PORTA ?? 4747));
  const browser = await chromium.launch();
  try {
    for (const tamanho of TAMANHOS) {
      for (const modo of MODOS) {
        const sufixo = `${tamanho.rotulo}-${modo.rotulo}`;
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme, timezoneId: "America/Sao_Paulo" });
        const page = await contexto.newPage();
        meta.cenario = {};
        meta.chamadas.length = 0;
        await zerar();
        await entrar(page);

        // Sem Instagram ligado: a folha explica o caminho.
        await abrirRoteiro(page);
        await abrirMenu(page);
        await foto(page, saida, "01-menu-com-publicar", sufixo);
        await page.getByRole("menuitem", { name: t.abrir }).click();
        await page.locator("[data-parte='sem-condicao']").waitFor();
        await page.waitForTimeout(500);
        await foto(page, saida, "02-sem-instagram-ligado", sufixo);

        // Ligado sem a publicação liberada (a configuração da Meta ainda não pede a permissão): a Conta avisa e a folha manda ligar de novo.
        meta.cenario = { permissoesLiberadas: ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"] };
        await ligarInstagram(page);
        await page.getByTestId("seu-instagram").scrollIntoViewIfNeeded();
        await foto(page, saida, "03-conta-publicar-falta", sufixo);
        await abrirRoteiro(page);
        await abrirFolha(page);
        await foto(page, saida, "04-sem-permissao-de-publicar", sufixo);

        // Ligado com tudo liberado: a Conta diz que a publicação está liberada.
        meta.cenario = {};
        await ligarInstagram(page);
        await page.getByTestId("seu-instagram").scrollIntoViewIfNeeded();
        await foto(page, saida, "05-conta-publicar-liberada", sufixo);

        // A folha, pronta para escolher o vídeo: a legenda do roteiro já vem preenchida.
        await abrirRoteiro(page);
        await abrirFolha(page);
        await foto(page, saida, "06-folha-reels-vazia", sufixo);

        // Com o vídeo escolhido.
        await page.locator("input[type=file]").setInputFiles(VIDEO);
        await page.getByText("meu-video.mp4").waitFor();
        await page.waitForTimeout(400);
        await foto(page, saida, "07-folha-reels-com-video", sufixo);

        // Story: some o campo da legenda.
        await page.getByRole("button", { name: t.story }).click();
        await page.waitForTimeout(300);
        await foto(page, saida, "08-folha-story", sufixo);
        await page.getByRole("button", { name: t.reels }).click();

        // Formato errado.
        await page.locator("input[type=file]").setInputFiles({ name: "anotacoes.txt", mimeType: "text/plain", buffer: Buffer.from("oi") });
        await page.getByRole("alert").first().waitFor();
        await foto(page, saida, "09-formato-errado", sufixo);

        // Enviando (o servidor de envio da Meta simulada demora a responder) e depois a Meta preparando o vídeo.
        meta.cenario = { demoraNoEnvioMs: 6000, statusDoContainer: ["IN_PROGRESS"] };
        await page.locator("input[type=file]").setInputFiles(VIDEO);
        await page.getByText("meu-video.mp4").waitFor();
        await page.getByRole("button", { name: t.publicar }).click();
        await page.locator("[data-parte='enviando']").waitFor();
        await page.waitForTimeout(1200);
        await foto(page, saida, "10-enviando", sufixo);
        await page.locator("[data-parte='processando']").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
        await foto(page, saida, "11-processando", sufixo);

        // Publicado.
        meta.cenario = {};
        await page.locator("[data-parte='publicada']").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
        await foto(page, saida, "12-publicado", sufixo);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
        await foto(page, saida, "13-roteiro-postado", sufixo);

        // A Meta recusa o vídeo.
        await zerar();
        meta.cenario = {};
        await ligarInstagram(page);
        meta.cenario = { erroNaPublicacao: "envio" };
        await abrirRoteiro(page);
        await abrirFolha(page);
        await page.locator("input[type=file]").setInputFiles(VIDEO);
        await page.getByText("meu-video.mp4").waitFor();
        await page.getByRole("button", { name: t.publicar }).click();
        await page.locator("[data-parte='motivo-da-falha']").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
        await foto(page, saida, "14-recusado-pela-meta", sufixo);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await meta.fechar();
    await getPool().end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
