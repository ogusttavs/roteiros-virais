/**
 * Capturas da E46 PR 3 (Rotinas e Custos), a 1024 e 1280 em claro e escuro, mais 390 só para provar que nada quebra: a madrugada por ramo, os cartões das rotinas (com um
 * detalhe aberto), os Custos (com e sem teto estourado, o fixo sendo adicionado). Nenhum dado de cliente: os gastos são de exemplo, criados aqui.
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` ou `npm run start` na porta de
 * `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e46-pr3.ts <nome-da-pasta>` (ex.: "pr-121").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes, configuracaoAdmin, custosFixos, execucoesJob, geracoesIA } from "../src/db/schema";

const SENHA = "ExemploSenha123";
const ADMIN = "admin@exemplo.teste";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 1024, altura: 768 },
  { largura: 1280, altura: 900 },
  { largura: 390, altura: 844 },
];

async function entrar(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/entrar`);
  await page.getByLabel("E-mail").fill(ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function prepararBanco(): Promise<void> {
  const [conta] = await db().select().from(clientes).limit(1);
  const agora = Date.now();
  const gerar = (dias: number, usd: string, tarefa: string, clienteId: number | null) =>
    db().insert(geracoesIA).values({ tarefa, versaoPrompt: "0", modelo: "mock", entradas: {}, clienteId, custoUsd: usd, criadoEm: new Date(agora - dias * 24 * 60 * 60 * 1000) } as never);
  for (let d = 1; d <= 20; d++) {
    await gerar(d, "0.30", "roteiro", conta.id);
    await gerar(d, "0.12", "temasDoDia", null);
    await gerar(d, "0.20", "extrairVideo", null);
  }
  await db().insert(execucoesJob).values([
    { nome: "transcrever", status: "ok", terminadoEm: new Date(), resumo: { transcritos: 40, falhas: 0 } },
    { nome: "coleta-apify", status: "erro", erro: "o limite da conta no Apify acabou", terminadoEm: new Date() },
    { nome: "temas-do-dia", status: "ok", terminadoEm: new Date(), resumo: { setores: 2, temas: 6 } },
  ]);
  await db().delete(custosFixos);
  await db().insert(custosFixos).values([
    { nome: "Duas contas de desenvolvimento", valor: "1200.00", moeda: "brl", periodo: "mensal", cobra: "cartão, no começo do mês" },
    { nome: "Coletas compartilhadas", valor: "60.00", moeda: "usd", periodo: "mensal", cobra: "todo dia 8" },
    { nome: "Servidor", valor: "109.00", moeda: "brl", periodo: "mensal", cobra: "todo dia 5" },
  ]);
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e46-pr3.ts <nome-da-pasta> (ex.: "pr-121")');
    process.exitCode = 1;
    return;
  }
  const base = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pasta = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pasta, { recursive: true });
  await prepararBanco();

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tela of LARGURAS) {
        const ctx = await browser.newContext({ viewport: { width: tela.largura, height: tela.altura }, colorScheme: modo.colorScheme });
        const page = await ctx.newPage();
        const foto = async (grupo: string, estado: string) => {
          const arquivo = path.join(pasta, `${grupo}.${estado}.${tela.largura}.${modo.rotulo}.png`);
          await page.screenshot({ path: arquivo, fullPage: true });
          gravados.push(arquivo);
        };
        await entrar(page, base);

        await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, "teto_diario_brl"));
        await page.goto(`${base}/admin/jobs`);
        await assentar(page);
        await foto("AdminRotinas", "Normal");
        await page.locator('[data-rotina="buscar"]').getByText("Ver o detalhe").click();
        await foto("AdminRotinas", "Detalhe");

        await page.goto(`${base}/admin/custos`);
        await assentar(page);
        await foto("AdminCustos", "Normal");
        await page.getByRole("button", { name: "Adicionar um fixo" }).click();
        await foto("AdminCustos", "NovoFixo");
        await page.getByRole("button", { name: "Cancelar" }).first().click();
        await page.getByRole("button", { name: /^Tirar Servidor/ }).click();
        await foto("AdminCustos", "TirarFixo");

        // Teto estourado: o teto cai para R$ 1 e o aviso aparece.
        await db().insert(configuracaoAdmin).values({ chave: "teto_diario_brl", valor: "1" });
        await db().insert(geracoesIA).values({ tarefa: "extrairVideo", versaoPrompt: "0", modelo: "mock", entradas: {}, custoUsd: "4.00" } as never);
        await page.goto(`${base}/admin/custos`);
        await assentar(page);
        await foto("AdminCustos", "PassouDoTeto");
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
