/**
 * Capturas da E49 PR 2 (os exemplos por ficha), a 390 e 1280, claro e escuro: o Criar com a ficha escolhida e os exemplos, o Criar sem exemplos, as Referências com a pílula
 * "Parece feito para" aberta, filtrada com o selo no cartão, e o estado vazio. Nenhum dado de cliente: a marca é a do seed; as fichas dos vídeos do setor são semeadas aqui, só no banco de dev.
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` ou `npm run start` na porta de
 * `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e49-pr2.ts <nome-da-pasta>` (ex.: "pr-123").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes, user } from "../src/db/schema";

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
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e49-pr2.ts <nome-da-pasta> (ex.: "pr-123")');
    process.exitCode = 1;
    return;
  }
  // As fichas dos vídeos do setor da marca do seed: uma ficha por vídeo, em rodízio, menos "Que chamem" (para o estado sem exemplos).
  const [u] = await db().select({ id: user.id }).from(user).where(eq(user.email, SEED));
  const [marca] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.usuarioId, u.id));
  await db().execute(sql`
    update videos set ficha_catalogo = (array['veja','guardem','mandem','comentem'])[1 + (id % 4)]
    where nicho_id = ${marca.nichoId} and analise is not null`);
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

        // O Criar: a ficha escolhida com os exemplos; uma ficha sem exemplos.
        await page.goto(`${base}/criar/objetivo?livre=${encodeURIComponent("a mancha que todo mundo tem no sofa")}`);
        await assentar(page);
        await foto("Criar", "Cinco");
        await page.getByRole("radio", { name: /Que guardem para depois/ }).click();
        await page.waitForSelector("[data-exemplos='com'], [data-exemplos='sem']");
        await assentar(page);
        await foto("Criar", "ComExemplos");
        await page.getByRole("button", { name: "Ver as cinco de novo" }).click();
        await page.getByRole("radio", { name: /Que me chamem/ }).click();
        await page.waitForSelector("[data-exemplos='sem']");
        await assentar(page);
        await foto("Criar", "SemExemplos");

        // As Referências: a pílula aberta, filtrada com o selo no cartão, e o vazio.
        await page.goto(`${base}/referencias?seg=todos`);
        await assentar(page);
        await foto("Referencias", "Todos", false);
        await page.locator("[data-pilula-feito-para]").getByRole("button").first().click();
        await page.waitForTimeout(400);
        await foto("Referencias", "PilulaAberta", false);
        await page.keyboard.press("Escape");
        await page.goto(`${base}/referencias?seg=todos&feitoPara=guardem`);
        await assentar(page);
        await foto("Referencias", "Filtrada", false);
        await page.goto(`${base}/referencias?seg=todos&feitoPara=me_chamem`);
        await assentar(page);
        await foto("Referencias", "Vazio", false);
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
