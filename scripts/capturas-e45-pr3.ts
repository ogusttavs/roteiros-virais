/**
 * Capturas do PR 3 da E45 (um ramo principal e até dois alternativos, só o admin liga): o bloco "Ramos alternativos" na página da marca (vazio,
 * com o aviso de custo antes de confirmar, com dois ligados), as Referências com a pílula "Ramo" e o selo do ramo no cartão, e a Conta com a
 * frase só de leitura, em 390 e 1280, claro e escuro. Nenhum dado de cliente: as marcas são as do seed.
 *
 * Os estados do admin passam pela tela de verdade (ligar cria linhas em `ramos_da_conta`); ao fim cada combinação desfaz: apaga os ramos
 * alternativos da marca. Os estados do cliente semeiam o alternativo direto (o outro setor do seed). Os setores que `ligar` faz nascer
 * continuam no banco de desenvolvimento, como nasceriam pela tela.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`,
 * `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e45-pr3.ts <nome-da-pasta>` (ex.: "pr-112").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { eq, ne } from "drizzle-orm";

import { ramoPorSlug } from "../src/config/ramos";
import { db, getPool } from "../src/db";
import { nichos, ramosDaConta } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const USUARIO_CONTA = "seed-cliente-limpeza";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
}

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
}

async function fotografarJanela(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await alvo.evaluate((el) => {
    const topo = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo(0, Math.max(0, topo));
  });
  await page.screenshot({ path: arquivo });
}

async function entrar(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e45-pr3.ts <nome-da-pasta> (ex.: "pr-112")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO_CONTA);
  if (!marca?.nichoId) throw new Error('cliente de seed nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).');
  const [outroSetor] = await db().select().from(nichos).where(ne(nichos.id, marca.nichoId)).limit(1);
  if (!outroSetor) throw new Error("o seed precisa de um segundo setor.");

  // "Nutrição" já pesquisado (setor ligado, outra marca o usaria); "Advocacia" parada (vai começar hoje): os dois avisos de custo.
  async function garantirSetor(slug: string, nome: string, ativo: boolean): Promise<void> {
    const [existente] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, slug));
    if (existente) await db().update(nichos).set({ ativo }).where(eq(nichos.id, existente.id));
    else await db().insert(nichos).values({ slug: `captura-${slug}`, nome, ramoCatalogo: slug, termos: [], ativo });
  }

  async function desfazer(): Promise<void> {
    await db().delete(ramosDaConta).where(eq(ramosDaConta.clienteId, marca.id));
  }

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    await garantirSetor("nutricao", "Nutrição", true);
    await garantirSetor("advocacia", "Advocacia", false);
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const novoContexto = () => browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });

        // ---------------------------------------------------------------- Admin, o bloco na página da marca
        {
          await desfazer();
          const contexto = await novoContexto();
          const page = await contexto.newPage();
          await entrar(page, baseUrl, EMAIL_ADMIN);
          await page.goto(`${baseUrl}/admin/clientes/${marca.id}`);
          const bloco = page.locator("[data-ramos-alternativos]");
          await bloco.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");

          const vazio = nomeDe("AdminMarca.RamosAlternativos", "Vazio");
          await fotografarElemento(page, bloco, vazio);
          gravados.push(vazio);

          // O primeiro, já pesquisado: sem custo novo.
          await bloco.getByRole("button", { name: "ligar outro ramo" }).click();
          await bloco.getByRole("combobox").fill("nutri");
          await page.getByRole("option", { name: /Nutrição/ }).first().click();
          await bloco.locator("[data-previa-ramo='pesquisado']").waitFor({ state: "visible" });
          const pesquisado = nomeDe("AdminMarca.RamosAlternativos", "CustoJaPesquisado");
          await fotografarElemento(page, bloco, pesquisado);
          gravados.push(pesquisado);
          await bloco.getByRole("button", { name: "ligar Nutrição" }).click();
          await bloco.locator("[data-ramo-alternativo]").first().waitFor({ state: "visible" });

          // O segundo, parado: vai começar a ser pesquisado hoje, com o custo dito antes de confirmar.
          await bloco.getByRole("button", { name: "ligar outro ramo" }).click();
          await bloco.getByRole("combobox").fill("advoc");
          await page.getByRole("option", { name: /Advocacia/ }).first().click();
          await bloco.locator("[data-previa-ramo='comeca']").waitFor({ state: "visible" });
          const comeca = nomeDe("AdminMarca.RamosAlternativos", "CustoVaiComecar");
          await fotografarElemento(page, bloco, comeca);
          gravados.push(comeca);
          await bloco.getByRole("button", { name: "ligar Advocacia" }).click();
          await page.waitForFunction(() => document.querySelectorAll("[data-ramo-alternativo]").length === 2);
          const comDois = nomeDe("AdminMarca.RamosAlternativos", "ComDois");
          await fotografarElemento(page, bloco, comDois);
          gravados.push(comDois);
          await contexto.close();
        }

        // ---------------------------------------------------------------- O cliente: Referências e Conta
        {
          await desfazer();
          await db().insert(ramosDaConta).values({ clienteId: marca.id, nichoId: outroSetor.id });
          const contexto = await novoContexto();
          const page = await contexto.newPage();
          await entrar(page, baseUrl, `${USUARIO_CONTA}@exemplo.teste`);
          await page.goto(`${baseUrl}/referencias?seg=todos&periodo=90&plataforma=todas`);
          const pilula = page.locator("[data-pilula-ramo]");
          await pilula.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");

          await pilula.getByRole("button", { name: "Ramo" }).click();
          await page.getByRole("menuitemradio", { name: "Todos os ramos" }).waitFor({ state: "visible" });
          const aberta = nomeDe("Referencias.PilulaRamo", "Aberta");
          await fotografarJanela(page, pilula, aberta);
          gravados.push(aberta);

          await page.getByRole("menuitemradio", { name: new RegExp(ramoPorSlug(outroSetor.ramoCatalogo)?.nome ?? outroSetor.nome) }).click();
          await page.waitForURL(/ramo=/);
          await page.locator("[data-selo-ramo]").first().waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          const filtrado = nomeDe("Referencias.PilulaRamo", "FiltradoPorRamo");
          await fotografarJanela(page, page.locator("[data-pilula-ramo]"), filtrado);
          gravados.push(filtrado);

          await page.goto(`${baseUrl}/conta`);
          const frase = page.locator("[data-ramos-alternativos-conta]");
          await frase.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          const conta = nomeDe("Conta.RamosAlternativos", "Frase");
          await fotografarElemento(page, page.locator("form").first(), conta);
          gravados.push(conta);
          await contexto.close();
        }
      }
    }
  } finally {
    await desfazer();
    await browser.close();
    await getPool().end();
  }
  console.log(`${gravados.length} capturas em ${pastaDestino}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
