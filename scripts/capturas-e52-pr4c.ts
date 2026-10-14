/**
 * Capturas da E52 parte 4c (Referências com a pílula "Duração" e o cartão do vídeo longo, passo 25 do Opus): a lista dos longos, um cartão com a leitura da estrutura ("o capítulo que
 * interessa" no trilho), um sem leitura ("Ver desde o começo"), a folha "Filtrar" com o grupo Duração (390) e o ramo sem vídeo longo com a frase calma, em 390 e 1280, claro e escuro. Nenhum
 * dado de cliente: a marca é a da limpeza do seed e os vídeos longos são inventados (o script os põe no ramo, tira as fotos e apaga o que pôs).
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` de desenvolvimento ou descartável, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock CAPTURAS_URL=http://localhost:3292 npx tsx scripts/capturas-e52-pr4c.ts <nome-da-pasta>` (ex.: "pr-e52-4c").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { videos, type AnaliseVideoLonga } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const PREFIXO = "captura-4c-longo-";
const DIA_MS = 24 * 60 * 60 * 1000;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

function analise(entregaAteS: number | null): AnaliseVideoLonga {
  return {
    versaoPrompt: "1.0.0",
    origemDosCapitulos: "descricao",
    assunto: "mancha no sofá",
    abertura: { promessa: "mostra o antes e o depois da mancha", entregaAteS, tipo: "resultado" },
    capitulos: [
      { inicioS: 0, nome: "A mancha que volta", oQueFaz: "mostra o resultado", gancho: "mas o erro vem a seguir" },
      { inicioS: 90, nome: "Erro 1: esfregar antes do tempo", oQueFaz: "esfrega", gancho: "e o segundo é pior" },
      { inicioS: 192, nome: "o teste no canto escondido", oQueFaz: "canto escondido", gancho: "falta o último" },
      { inicioS: 245, nome: "O que fazer amanhã", oQueFaz: "resume", gancho: null },
    ],
    lacos: [],
    ondeSairia: [],
    fechamento: { oQueFaz: "pede o comentário", apontaParaProximoVideo: false },
    porQueFuncionou: "mostra o resultado antes de explicar",
  };
}

const DESCRICAO = ["00:00 A mancha que volta", "01:30 Erro 1: esfregar antes do tempo", "03:12 o teste no canto escondido", "04:05 O que fazer amanhã"].join(String.fromCharCode(10));

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
}

async function fotografar(page: Page, alvo: Locator | null, arquivo: string): Promise<void> {
  await limparTela(page);
  if (alvo) await alvo.screenshot({ path: arquivo });
  else await page.screenshot({ path: arquivo, fullPage: true });
}

async function main(): Promise<void> {
  const pasta = process.argv[2];
  if (!pasta) throw new Error("uso: npx tsx scripts/capturas-e52-pr4c.ts <nome-da-pasta>");
  const destino = path.join(process.cwd(), "..", "entregaveis", "design", "capturas", pasta);
  await mkdir(destino, { recursive: true });
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra um banco de desenvolvimento (nunca roteiros).`);
  const nichoId = marca.nichoId;
  await db().delete(videos).where(like(videos.idExterno, `${PREFIXO}%`));
  const modelo = { plataforma: "youtube" as const, nichoId, origem: "coleta" as const, idioma: "pt", publicadoEm: new Date(Date.now() - 12 * DIA_MS) };
  await db()
    .insert(videos)
    .values([
      { ...modelo, idExterno: `${PREFIXO}1`, url: "https://www.youtube.com/watch?v=capt4c0001a", titulo: "os 4 erros que estragam o sofá, e como evitar", descricao: DESCRICAO, views: 412_000, foraDaCurva: "4.6", duracaoS: 662, analiseLonga: analise(200) },
      { ...modelo, idExterno: `${PREFIXO}2`, url: "https://www.youtube.com/watch?v=capt4c0002b", titulo: "como organizar o armário da cozinha de vez", views: 280_000, foraDaCurva: "3.1", duracaoS: 1120 },
      { ...modelo, idExterno: `${PREFIXO}3`, url: "https://www.youtube.com/watch?v=capt4c0003c", titulo: "antes e depois: limpeza do estofado", descricao: DESCRICAO, views: 190_000, foraDaCurva: "2.7", duracaoS: 495, analiseLonga: analise(null) },
    ]);

  const navegador = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await navegador.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        await page.goto(`${baseUrl}/entrar`);
        await page.getByLabel("E-mail").fill(EMAIL);
        await page.getByLabel("Senha").fill(SENHA_SEED);
        await page.getByRole("button", { name: "entrar", exact: true }).click();
        await page.waitForLoadState("networkidle");
        await page.goto(`${baseUrl}/referencias?duracao=longos&periodo=30&plataforma=todas`);
        await page.locator("[data-cartao-longo]").first().waitFor();
        await page.waitForLoadState("networkidle");
        const nome = `Referencias.Longos.${tamanho.rotulo}.${modo.rotulo}`;
        await fotografar(page, null, path.join(destino, `${nome}.png`));
        await fotografar(page, page.locator("[data-cartao-longo]").filter({ hasText: "os 4 erros" }), path.join(destino, `Referencias.LongoCartao.ComLeitura.${tamanho.rotulo}.${modo.rotulo}.png`));
        await fotografar(page, page.locator("[data-cartao-longo]").filter({ hasText: "armário da cozinha" }), path.join(destino, `Referencias.LongoCartao.SemLeitura.${tamanho.rotulo}.${modo.rotulo}.png`));
        if (tamanho.largura < 1024) {
          await page.getByRole("button", { name: /^Filtrar/ }).click();
          await page.getByRole("dialog", { name: "Filtrar" }).waitFor();
          await fotografar(page, page.getByRole("dialog", { name: "Filtrar" }), path.join(destino, `Referencias.Filtrar.Duracao.${tamanho.rotulo}.${modo.rotulo}.png`));
        } else {
          await page.getByRole("button", { name: /^Mais de 3 min/ }).click();
          await fotografar(page, null, path.join(destino, `Referencias.Longos.PilulaAberta.${tamanho.rotulo}.${modo.rotulo}.png`));
        }
        await contexto.close();
      }
    }
  } finally {
    await navegador.close();
    await db().delete(videos).where(like(videos.idExterno, `${PREFIXO}%`));
    await getPool().end();
  }
}

void main();
