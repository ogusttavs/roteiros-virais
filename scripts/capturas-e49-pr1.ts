/**
 * Capturas da E49 PR 1 (as cinco fichas), a 390 e 1280, claro e escuro: a tela do Objetivo no Reels e no Story, a folha "Gravar agora" nos dois formatos, o roteiro com
 * "Para que ..." ao lado do tipo, e o Hoje com o rótulo novo. Nenhum dado de cliente: a marca é a do seed.
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` ou `npm run start` na porta de
 * `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e49-pr1.ts <nome-da-pasta>` (ex.: "pr-122").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { getPool } from "../src/db";

const SENHA = "ExemploSenha123";
const SEED = "seed-cliente-limpeza@exemplo.teste";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 390, altura: 844, celular: true },
  { largura: 1280, altura: 900, celular: false },
];

async function entrar(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/entrar`);
  await page.getByLabel("E-mail").fill(SEED);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e49-pr1.ts <nome-da-pasta> (ex.: "pr-122")');
    process.exitCode = 1;
    return;
  }
  const base = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pasta = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pasta, { recursive: true });

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tela of LARGURAS) {
        const ctx = await browser.newContext({ viewport: { width: tela.largura, height: tela.altura }, colorScheme: modo.colorScheme, isMobile: tela.celular, hasTouch: tela.celular });
        const page = await ctx.newPage();
        const foto = async (grupo: string, estado: string, inteira = true) => {
          const arquivo = path.join(pasta, `${grupo}.${estado}.${tela.largura}.${modo.rotulo}.png`);
          await page.screenshot({ path: arquivo, fullPage: inteira });
          gravados.push(arquivo);
        };
        await entrar(page, base);

        // O Objetivo: Reels (as cinco), troca de ficha, Story (sem pergunta).
        await page.goto(`${base}/criar/objetivo?livre=${encodeURIComponent("a mancha que todo mundo tem no sofa")}`);
        await assentar(page);
        await foto("Objetivo", "Objetivo");
        await page.getByRole("radio", { name: /Que mandem para alguém/ }).click();
        await foto("Objetivo", "Escolhida");
        await page.getByRole("tab", { name: "Story" }).click();
        await assentar(page);
        await foto("Objetivo", "Story");

        // O roteiro com a ficha ao lado do tipo.
        await page.getByRole("tab", { name: "Reels" }).click();
        await page.getByRole("radio", { name: /Que guardem para depois/ }).click();
        await page.getByRole("button", { name: "escrever o roteiro" }).click();
        await page.waitForURL(/\/roteiros\/\d+/, { timeout: 60_000 });
        await assentar(page);
        await foto("Roteiro", "ComFicha", false);

        // O Hoje, com a agenda mostrando o rótulo novo.
        await page.goto(`${base}/hoje`);
        await assentar(page);
        await foto("Hoje", "ComFicha", false);

        // A folha Gravar agora, nos dois formatos.
        await page.goto(`${base}/criar`);
        await assentar(page);
        await page.getByRole("button", { name: "Contar o momento" }).click();
        await page.waitForTimeout(700);
        await foto("GravarAgora", "Reels", false);
        await page.getByRole("dialog", { name: "Gravar agora" }).getByRole("tab", { name: "Story" }).click();
        await page.waitForTimeout(400);
        await foto("GravarAgora", "Story", false);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await getPool().end();
  }
  for (const arquivo of gravados) console.log(arquivo);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
