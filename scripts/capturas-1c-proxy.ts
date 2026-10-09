/**
 * Capturas do 1c (hotfix do proxy do YouTube): o aviso no Início do admin ("o proxy do YouTube está sem tráfego desde <dia>"), o cartão da rotina Transcrever com a mesma frase, e o tráfego do
 * proxy em Custos, "Fora da IA", em 390 e 1280, claro e escuro. Nenhum dado de cliente: o script grava duas noites do `transcrever` paradas pelo proxy e um custo de 1,5 GB em
 * `roteiros_dev`, tira uma foto de cada tela e apaga o que gravou.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-1c-proxy.ts <nome-da-pasta>` (ex.: "pr-146").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { custosExternos, execucoesJob } from "../src/db/schema";

const SENHA_SEED = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const DIA_MS = 24 * 60 * 60 * 1000;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

/** Esconde o portal do Next em desenvolvimento e tudo o que é fixo (as barras ficam por cima do recorte). */
async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
}

/** O elemento inteiro, recortado da página inteira. */
async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-1c-proxy.ts <nome-da-pasta> (ex.: "pr-146")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  // Duas noites seguidas paradas pelo proxy (a mais antiga anotou o instante) e o tráfego medido, de ontem (os 30 dias de Custos vão até ontem).
  const desde = new Date(Date.now() - 3 * DIA_MS);
  const [antiga, recente] = await db()
    .insert(execucoesJob)
    .values([
      { nome: "transcrever", status: "ok", iniciadoEm: new Date(desde.getTime() + 60_000), terminadoEm: new Date(desde.getTime() + 120_000), resumo: { youtubePausado: true, youtubePausadoMotivo: "proxy sem trafego", proxyPausadoDesde: desde.toISOString(), falhasPorProxy: 1 } },
      { nome: "transcrever", status: "ok", iniciadoEm: new Date(Date.now() - 6 * 60 * 60 * 1000), terminadoEm: new Date(Date.now() - 6 * 60 * 60 * 1000 + 60_000), resumo: { youtubePausado: true, youtubePausadoMotivo: "proxy sem trafego", proxyPausadoDesde: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), falhasPorProxy: 1 } },
    ])
    .returning();
  const [custo] = await db()
    .insert(custosExternos)
    .values({ fonte: "proxy", custoUsd: "1.500000", unidades: "1500.000", unidade: "megabytes", origemDoCusto: "estimado", execucaoId: recente.id, criadoEm: new Date(Date.now() - 36 * 60 * 60 * 1000) })
    .returning();

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita (e a máquina pode estar ocupada com outra coisa): 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrar(page, baseUrl);

        await page.goto(`${baseUrl}/admin`);
        const estado = page.locator('[data-bloco="estado"]');
        await page.locator('[data-atencao="proxy"]').waitFor({ state: "visible" });
        const inicio = nomeDe("AdminInicio", "ProxySemTrafego");
        await fotografarElemento(page, estado, inicio);
        gravados.push(inicio);

        await page.goto(`${baseUrl}/admin/jobs`);
        const cartao = page.locator('[data-rotina="transcrever"]');
        await cartao.waitFor({ state: "visible" });
        const rotina = nomeDe("AdminRotinas", "TranscreverProxyParado");
        await fotografarElemento(page, cartao, rotina);
        gravados.push(rotina);

        await page.goto(`${baseUrl}/admin/custos`);
        const fora = page.locator('[data-bloco="fora-da-ia"]');
        await fora.waitFor({ state: "visible" });
        await page.locator('[data-fonte="proxy"]').waitFor({ state: "visible" });
        const custos = nomeDe("AdminCustos", "ForaDaIAProxy");
        await fotografarElemento(page, fora, custos);
        gravados.push(custos);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(custosExternos).where(eq(custosExternos.id, custo.id));
    await db().delete(execucoesJob).where(eq(execucoesJob.id, antiga.id));
    await db().delete(execucoesJob).where(eq(execucoesJob.id, recente.id));
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
