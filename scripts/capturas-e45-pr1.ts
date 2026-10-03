/**
 * Capturas do PR 1 da E45 (o catálogo de ramos e a busca instantânea): o campo de ramo do Começar em cada estado (vazio, lista
 * aberta, digitando as quatro palavras da ordem, sem resultado, "Não achei o meu", escolhido) e o ramo na Conta (o de hoje, a lista,
 * o aviso ao trocar), em 390 e 1280, claro e escuro. Nada é salvo: o script só digita e escolhe na tela, então nenhum setor nasce.
 * Nenhum dado de cliente: o cliente é o dos dentistas do seed (o que fica de propósito sem briefing completo).
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`,
 * `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `npm run capturas:e45-pr1 -- <nome-da-pasta>` (ex.: "pr-110").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-dentistas";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

/** Esconde o portal do Next em desenvolvimento (selo "Issue") e tudo o que é fixo (as barras ficam por cima do recorte). */
async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
}

/** O elemento inteiro, recortado da página inteira (sem barras fixas por cima). */
async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
}

/** A janela, com o campo perto do topo: a lista aberta cai por cima do que vem embaixo, e o recorte por elemento não a pegaria. */
async function fotografarJanela(page: Page, campo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await campo.evaluate((el) => {
    const topo = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo(0, Math.max(0, topo));
  });
  await page.screenshot({ path: arquivo });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: npm run capturas:e45-pr1 -- <nome-da-pasta> (ex.: "pr-110")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  }
  const original = { nichoId: cliente.nichoId, ramoOutro: cliente.ramoOutro, alcance: cliente.alcance };

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);

        // O Começar: a marca sem ramo, sem setor e sem "onde" (cai na introdução, e "Começar" leva ao passo).
        await db().update(clientes).set({ nichoId: null, ramoOutro: null, alcance: null }).where(eq(clientes.id, cliente.id));
        await page.goto(`${baseUrl}/comecar`);
        await page.getByRole("button", { name: "Começar", exact: true }).click();
        const campo = page.getByRole("combobox", { name: "Ramo" });
        await campo.waitFor({ state: "visible" });
        const cartao = page.locator("form > div").first();

        const vazio = nomeDe("Comecar", "RamoVazio");
        await fotografarElemento(page, cartao, vazio);
        gravados.push(vazio);

        await campo.click();
        const aberta = nomeDe("Comecar", "RamoListaAberta");
        await fotografarJanela(page, campo, aberta);
        gravados.push(aberta);

        for (const palavra of ["dentista", "piloto", "envelopamento", "dieta"]) {
          await campo.fill(palavra);
          await page.getByRole("option").first().waitFor({ state: "visible" });
          const arquivo = nomeDe("Comecar", `RamoDigitando-${palavra}`);
          await fotografarJanela(page, campo, arquivo);
          gravados.push(arquivo);
        }

        await campo.fill("criação de abelhas");
        await page.getByText("Nenhum ramo começa com").waitFor({ state: "visible" });
        const semResultado = nomeDe("Comecar", "RamoSemResultado");
        await fotografarJanela(page, campo, semResultado);
        gravados.push(semResultado);

        await page.getByRole("option", { name: /Não achei o meu/ }).click();
        await page.getByLabel("Qual é o seu ramo").waitFor({ state: "visible" });
        const naoAchei = nomeDe("Comecar", "RamoNaoAchei");
        await fotografarElemento(page, cartao, naoAchei);
        gravados.push(naoAchei);

        await campo.fill("dentista");
        await campo.press("Enter");
        const escolhido = nomeDe("Comecar", "RamoEscolhido");
        await fotografarElemento(page, cartao, escolhido);
        gravados.push(escolhido);

        // A Conta, com a marca como estava (o ramo dos dentistas do seed).
        await db()
          .update(clientes)
          .set({ nichoId: original.nichoId, ramoOutro: original.ramoOutro, alcance: original.alcance ?? "brasil" })
          .where(eq(clientes.id, cliente.id));
        await page.goto(`${baseUrl}/conta`);
        const campoDaConta = page.getByRole("combobox", { name: "ramo" });
        await campoDaConta.waitFor({ state: "visible" });
        const contaRamo = nomeDe("Conta", "Ramo");
        await fotografarElemento(page, page.locator("form").first(), contaRamo);
        gravados.push(contaRamo);

        await campoDaConta.fill("confeit");
        await page.getByRole("option").first().waitFor({ state: "visible" });
        const contaLista = nomeDe("Conta", "RamoLista");
        await fotografarJanela(page, campoDaConta, contaLista);
        gravados.push(contaLista);

        await campoDaConta.press("Enter");
        await page.getByText("Ao trocar, a base de vídeos e os temas passam a ser os do ramo novo").waitFor({ state: "visible" });
        const contaTrocando = nomeDe("Conta", "RamoTrocando");
        await fotografarElemento(page, page.locator("form").first(), contaTrocando);
        gravados.push(contaTrocando);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    // Deixa a marca de seed como estava.
    await db()
      .update(clientes)
      .set({ nichoId: original.nichoId, ramoOutro: original.ramoOutro, alcance: original.alcance })
      .where(eq(clientes.id, cliente.id));
  }

  console.log(`${gravados.length} captura(s) gravada(s) em ${pastaDestino}`);
  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
