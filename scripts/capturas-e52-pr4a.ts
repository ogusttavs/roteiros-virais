/**
 * Capturas da E52 parte 4a ("Quanto tempo?", passo 25 do Opus) na folha "Gravar agora": o estado calmo do ramo sem a medida dos vídeos longos (a opção longa apagada com a frase ao lado), o
 * curto escolhido num ramo com a medida, e o longo escolhido (a medida do ramo dita e a linha da pesquisa trocada pela frase), em 390 e 1280, claro e escuro. Nenhum dado de cliente: a marca é a
 * da limpeza do seed e os vídeos longos são inventados (o script os põe no ramo, tira as fotos e apaga o que pôs).
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para um banco de desenvolvimento ou descartável, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta
 * de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr4a.ts <nome-da-pasta>` (ex.: "pr-e52-4a").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { videos } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const PREFIXO = "captura-4a-longo-";
const DIA_MS = 24 * 60 * 60 * 1000;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
}

async function fotografar(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await alvo.screenshot({ path: arquivo });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

/** Abre "Gravar agora" e leva a pergunta de duração para dentro da vista da folha. */
async function abrirFolha(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(`${baseUrl}/criar`);
  await page.getByRole("button", { name: "Contar o momento" }).click();
  const folha = page.getByRole("dialog", { name: "Gravar agora" });
  await folha.waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await folha.locator("[data-duracao]").scrollIntoViewIfNeeded();
  return folha;
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr4a.ts <nome-da-pasta> (ex.: "pr-e52-4a")');
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra um banco de desenvolvimento (nunca roteiros).`);
  const nichoId = marca.nichoId;

  /** Põe (ou tira) os três vídeos longos de exemplo do ramo: com eles o ramo tem a medida. */
  async function porLongos(): Promise<void> {
    for (const [indice, minutos] of [8, 10, 12].entries()) {
      await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `${PREFIXO}${indice}`,
          url: `https://exemplo.invalido/${PREFIXO}${indice}`,
          nichoId,
          titulo: `[exemplo] vídeo longo ${indice}`,
          views: 400_000,
          foraDaCurva: "3.000",
          duracaoS: minutos * 60,
          publicadoEm: new Date(Date.now() - 4 * DIA_MS),
          idioma: "pt",
        });
    }
  }
  async function tirarLongos(): Promise<void> {
    await db().delete(videos).where(like(videos.idExterno, `${PREFIXO}%`));
  }
  await tirarLongos();

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (estado: string) => path.join(pastaDestino, `GravarAgora.Duracao.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        page.setDefaultTimeout(120_000);
        await entrar(page, baseUrl);

        // 1. o ramo sem a medida: a opção longa apagada, com a frase calma
        await tirarLongos();
        let folha = await abrirFolha(page, baseUrl);
        const foto1 = nomeDe("SemMedida");
        await fotografar(page, folha, foto1);
        gravados.push(foto1);

        // 2. o ramo com a medida: o curto escolhido, as duas opções abertas
        await porLongos();
        folha = await abrirFolha(page, baseUrl);
        const foto2 = nomeDe("Curto");
        await fotografar(page, folha, foto2);
        gravados.push(foto2);

        // 3. o longo escolhido: a medida do ramo dita e a linha da pesquisa trocada pela frase
        await folha.getByRole("button", { name: "Mais de 3 minutos, para o YouTube" }).click();
        await folha.locator("[data-duracao]").scrollIntoViewIfNeeded();
        const foto3 = nomeDe("Longo");
        await fotografar(page, folha, foto3);
        gravados.push(foto3);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await tirarLongos();
  }

  console.log(`${gravados.length} captura(s) gravada(s) em ${pastaDestino}`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  // O pool do banco fica aberto se algo falhar no meio, e o processo nunca terminaria.
  .finally(() => getPool().end());
