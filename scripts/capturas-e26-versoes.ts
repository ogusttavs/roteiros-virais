/**
 * Capturas do PR da E26 4b, parte 2 (as versões do roteiro), em 390 e 1280, claro e escuro: a espera ("Escrevendo as três versões"), a comparação das três versões (no celular, a lista com a
 * de nota mais alta aberta e, no desktop, as três colunas), "Gerar outra" escrevendo a quarta, a quarta pronta marcada "Nova", e o cartão "Suas versões estão prontas" no Hoje. Nenhum dado de
 * cliente: a marca é a da limpeza do seed. O script pede as versões pela própria tela (com a IA simulada) e devolve o banco como estava (apaga o que criou).
 *
 * Pré-requisitos: um servidor de PRODUÇÃO (`npm run build` e `npm run start`, com `MODO_E2E=1`, como o `playwright.config.ts` sobe) em `CAPTURAS_URL`, no banco `roteiros_dev` (nunca `roteiros`) com
 * `npm run db:seed`, e `ROTEIROS_POR_DIA_MAX=200` nos dois lados (o servidor e este script: são muitas versões num dia só). As imagens do servidor de desenvolvimento saem com o indicador do Next
 * no canto.
 *
 * Uso: `ROTEIROS_POR_DIA_MAX=200 AI_PROVIDER=mock CAPTURAS_URL=http://localhost:3247 npx tsx scripts/capturas-e26-versoes.ts <nome-da-pasta>` (ex.: "pr-e26-versoes").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, eq, gte } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { versoesDoRoteiro } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const TEMA = "O erro que faz a mancha voltar depois da limpeza";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: ROTEIROS_POR_DIA_MAX=200 AI_PROVIDER=mock CAPTURAS_URL=... npx tsx scripts/capturas-e26-versoes.ts <nome-da-pasta> (ex.: "pr-e26-versoes")');
    process.exitCode = 1;
    return;
  }
  // O script apaga no fim o que escreveu: só no banco de desenvolvimento, nunca num que não seja ele.
  if (!/\/roteiros_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
    console.error("DATABASE_URL precisa apontar para roteiros_dev; este script apaga versoes_do_roteiro no fim.");
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3247";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const inicio = new Date(Date.now() - 1000);

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const tamanho of TAMANHOS) {
      for (const modo of MODOS) {
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        page.setDefaultTimeout(120_000);
        const nome = (tela: string) => path.join(pastaDestino, `${tela}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const foto = async (tela: string, inteira = true) => {
          await page.waitForLoadState("networkidle");
          await esconderPortal(page);
          if (inteira) {
            // A página inteira numa janela do tamanho dela: `fullPage` deixaria a barra do alto e a das abas (fixas) no meio da imagem.
            const altura = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: tamanho.largura, height: Math.max(altura, tamanho.altura) });
            await page.waitForTimeout(300);
          }
          await page.screenshot({ path: nome(tela), fullPage: false });
          if (inteira) await page.setViewportSize({ width: tamanho.largura, height: tamanho.altura });
          gravados.push(nome(tela));
        };
        await entrar(page, baseUrl);

        // A espera: o pedido do objetivo segurado por uns segundos, para a tela de espera aparecer na foto.
        await page.goto(`${baseUrl}/criar/objetivo?livre=${encodeURIComponent(TEMA)}`);
        await page.locator("[data-fichas]").getByRole("radio", { name: /Que me chamem/ }).click();
        let liberarEspera: () => void = () => undefined;
        const espera = new Promise<void>((resolve) => {
          liberarEspera = resolve;
        });
        await page.route("**/criar/objetivo*", async (rota) => {
          if (rota.request().method() === "POST") await espera;
          await rota.continue();
        });
        await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
        await page.getByText("Escrevendo as três versões").waitFor();
        await page.waitForTimeout(1500);
        await esconderPortal(page);
        await page.screenshot({ path: nome("Versoes.Esperando"), fullPage: false });
        gravados.push(nome("Versoes.Esperando"));
        liberarEspera();
        await page.waitForURL(/\/criar\/versoes\//, { timeout: 120_000 });
        await page.unroute("**/criar/objetivo*");

        // As três versões, e o Hoje com o cartão (o grupo acabou de nascer, sem escolha).
        await page.locator("article[data-versao]").nth(2).waitFor();
        await foto("Versoes.Comparar");
        await page.goto(`${baseUrl}/hoje`);
        await page.locator("[data-versoes-prontas]").waitFor();
        await foto("Hoje.VersoesProntas", false);
        await page.locator("[data-versoes-prontas]").getByRole("button", { name: "Escolher uma" }).click();
        await page.waitForURL(/\/criar\/versoes\//);

        // No celular, a segunda aberta (a primeira recolhe).
        if (tamanho.largura < 768) {
          await page.locator("article[data-versao]").nth(1).getByRole("button", { name: "Ler esta versão inteira" }).click();
          await foto("Versoes.SegundaAberta");
        }

        // "Gerar outra": a quarta sendo escrita (o pedido segurado) e depois pronta, marcada "Nova".
        let liberarOutra: () => void = () => undefined;
        const outra = new Promise<void>((resolve) => {
          liberarOutra = resolve;
        });
        await page.route("**/criar/versoes/**", async (rota) => {
          if (rota.request().method() === "POST") await outra;
          await rota.continue();
        });
        await page.getByRole("button", { name: "Gerar outra" }).click();
        await page.getByText("Escrevendo outra versão").waitFor();
        await foto("Versoes.GerandoOutra");
        liberarOutra();
        await page.locator("article[data-versao]").nth(3).waitFor();
        await page.unroute("**/criar/versoes/**");
        await foto("Versoes.QuatroVersoes");
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    // Devolve o banco: as versões que as capturas escreveram saem (nenhuma virou roteiro).
    await db().delete(versoesDoRoteiro).where(and(eq(versoesDoRoteiro.clienteId, marca.id), gte(versoesDoRoteiro.criadoEm, inicio)));
    await getPool().end();
  }
  for (const arquivo of gravados) console.log(arquivo);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
