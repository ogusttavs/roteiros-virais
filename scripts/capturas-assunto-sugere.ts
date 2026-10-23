/**
 * Capturas do "Acompanhar um assunto" que sugere enquanto a pessoa digita (melhoria da E53, 23/10/2026): a folha dos assuntos das Notícias com o que está em alta, a lista da nossa lista
 * enquanto digita, o assunto escolhido com as palavras prontas, o assunto que a lista não tem e as palavras sugeridas. A 390 e a 1280, claro e escuro. Nenhum dado de cliente: a marca é a do seed.
 *
 * Pré-requisitos: `DATABASE_URL` apontando para um banco de desenvolvimento semeado (`npm run db:reset`), `AI_PROVIDER=mock`, `npm run dev` na porta de `CAPTURAS_URL`. O script põe uma rodada de
 * tendências de exemplo e tira os assuntos da marca do seed antes; no fim apaga a rodada.
 *
 * Uso: `npx tsx scripts/capturas-assunto-sugere.ts`
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { assuntosDaMarca, clientes, tendenciasBrasil, user } from "../src/db/schema";

const SENHA_SEED = "ExemploSenha123";
const EMAIL = "seed-cliente-limpeza@exemplo.teste";
/** Marca as linhas da rodada de exemplo na `chave` (que a tela não mostra), para apagar só elas no fim. */
const MARCA_NA_CHAVE = "captura-";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 390, altura: 844 },
  { largura: 1280, altura: 800 },
];

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function prepararBanco(): Promise<void> {
  const [dono] = await db().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
  if (!dono) throw new Error("a marca do seed nao existe: rode npm run db:reset");
  const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, dono.id));
  await db().delete(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marca.id));
  await limparRodada();
  const rodadaEm = new Date(Date.now() - 60_000);
  await db()
    .insert(tendenciasBrasil)
    .values([
      { coletadaEm: rodadaEm, assunto: "Frente fria no Sul", chave: `${MARCA_NA_CHAVE}frente fria no sul`, termos: ["frente fria", "onda de frio", "geada"], fontes: [], posicao: 1, sensivel: false },
      { coletadaEm: rodadaEm, assunto: "Lançamento de celular dobrável", chave: `${MARCA_NA_CHAVE}lancamento de celular dobravel`, termos: ["celular dobrável", "lançamento", "Samsung"], fontes: [], posicao: 2, sensivel: false },
      { coletadaEm: rodadaEm, assunto: "Preço do café", chave: `${MARCA_NA_CHAVE}preco do cafe`, termos: ["preço do café", "café", "saca de café"], fontes: [], posicao: 3, sensivel: false },
    ]);
}

async function limparRodada(): Promise<void> {
  await db().delete(tendenciasBrasil).where(like(tendenciasBrasil.chave, `${MARCA_NA_CHAVE}%`));
}

async function main(): Promise<void> {
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3217";
  const pastaDestino = path.resolve(__dirname, "..", "..", "..", "..", "entregaveis", "design", "capturas", "assunto-sugere");
  await mkdir(pastaDestino, { recursive: true });
  await prepararBanco();

  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tam of LARGURAS) {
        const mobile = tam.largura < 768;
        const contexto = await browser.newContext({ viewport: { width: tam.largura, height: tam.altura }, colorScheme: modo.colorScheme, isMobile: mobile, hasTouch: mobile });
        const page = await contexto.newPage();
        await page.goto(`${baseUrl}/entrar`);
        await page.getByLabel("E-mail").fill(EMAIL);
        await page.getByLabel("Senha").fill(SENHA_SEED);
        await page.getByRole("button", { name: "entrar", exact: true }).click();
        await page.waitForURL(/\/hoje/);

        const foto = async (estado: string) => {
          await assentar(page);
          await page.screenshot({ path: path.join(pastaDestino, `Noticias.${estado}.${tam.largura}.${modo.rotulo}.png`) });
        };

        await page.goto(`${baseUrl}/noticias`);
        await page.getByRole("button", { name: "Acompanhar um assunto" }).click();
        const folha = page.getByRole("dialog", { name: "Os assuntos que você acompanha" });
        await folha.waitFor();
        const campo = folha.getByRole("combobox", { name: "Assunto" });

        await campo.click();
        await folha.locator("[data-sugestoes-de-assunto]").waitFor();
        await foto("1-EmAlta");

        await campo.fill("eleic");
        await folha.getByRole("option", { name: /^Eleições/ }).waitFor();
        await foto("2-Digitando");

        await campo.press("Enter");
        await folha.locator("[data-nota-das-palavras]").waitFor();
        await foto("3-Escolhido");

        await campo.fill("Torneio de xadrez");
        await folha.getByRole("button", { name: "Sugerir palavras" }).waitFor();
        await foto("4-ForaDaLista");

        await folha.getByRole("button", { name: "Sugerir palavras" }).click();
        await folha.locator("[data-nota-das-palavras]").waitFor();
        await foto("5-Sugerido");

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await limparRodada();
    await getPool().end();
  }
  console.log(`Capturas em ${pastaDestino}`);
}

void main();
