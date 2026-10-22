/**
 * Capturas do hotfix da barra de ação do Começar (22/10/2026): a introdução, os dados fixos e o primeiro bloco do briefing, a 1280, 1440 e 390,
 * claro e escuro. Nenhum dado de cliente: a marca é a do seed.
 *
 * Pré-requisitos: `DATABASE_URL` apontando para um banco de desenvolvimento semeado, `AI_PROVIDER=mock`, `npm run dev` na porta de `CAPTURAS_URL`.
 *
 * Uso: `npx tsx scripts/capturas-hotfix-barra.ts <nome-da-pasta>` (ex.: "antes" ou "depois").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

const SENHA_SEED = "ExemploSenha123";
const EMAIL = "seed-cliente-limpeza@exemplo.teste";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 1280, altura: 800 },
  { largura: 1440, altura: 900 },
  { largura: 390, altura: 844 },
];

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: npx tsx scripts/capturas-hotfix-barra.ts <nome-da-pasta> (ex.: "antes")');
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3310";
  const pastaDestino = path.resolve(__dirname, "..", "..", "..", "..", "entregaveis", "design", "capturas", "hotfix-barra", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tam of LARGURAS) {
        const mobile = tam.largura < 768;
        const contexto = await browser.newContext({
          viewport: { width: tam.largura, height: tam.altura },
          colorScheme: modo.colorScheme,
          isMobile: mobile,
          hasTouch: mobile,
        });
        const page = await contexto.newPage();
        await page.goto(`${baseUrl}/entrar`);
        await page.getByLabel("E-mail").fill(EMAIL);
        await page.getByLabel("Senha").fill(SENHA_SEED);
        await page.getByRole("button", { name: "entrar", exact: true }).click();
        await page.waitForURL(/\/hoje/);

        const foto = async (estado: string) => {
          await assentar(page);
          await page.screenshot({ path: path.join(pastaDestino, `Comecar.${estado}.${tam.largura}.${modo.rotulo}.png`) });
        };
        await page.goto(`${baseUrl}/comecar`);
        await foto("Introducao");
        // Diagnóstico: existe algum spinner/anel visível na introdução?
        const aneis = await page.evaluate(() =>
          Array.from(document.querySelectorAll("*"))
            .filter((el) => {
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return r.width > 120 && r.height > 120 && cs.borderRadius.includes("50%") && cs.display !== "none";
            })
            .map((el) => el.tagName + "." + el.className),
        );
        console.log(`${modo.rotulo} ${tam.largura}: elementos redondos grandes:`, aneis.length ? aneis : "nenhum");
        await page.getByRole("button", { name: "Começar", exact: true }).click();
        await page.waitForTimeout(1200);
        await foto("Passo2");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await foto("Passo2Fim");
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Capturas em ${pastaDestino}`);
}

void main();
