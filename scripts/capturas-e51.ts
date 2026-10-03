/**
 * Capturas da E51 PR 2 (a gramática de movimento e a busca de ramo dentro do cartão), a 390, claro e escuro: a folha subindo e arrastada, a tela entrando por
 * cima, o toque (botão e cartão apertados), o "Atualizar" com "Já estava em dia", e os seis estados do ramo na Conta. Nenhum dado de cliente: a marca é a do seed.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` na
 * porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e51.ts <nome-da-pasta>` (ex.: "pr-117").
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

async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
}

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await esconderPortal(page);
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e51.ts <nome-da-pasta> (ex.: "pr-117")');
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.390.${modo.rotulo}.png`);
      const foto = async (tela: string, estado: string, pagina: Page) => {
        const arquivo = nomeDe(tela, estado);
        await pagina.screenshot({ path: arquivo });
        gravados.push(arquivo);
      };
      const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: modo.colorScheme, isMobile: true, hasTouch: true });
      const page = await contexto.newPage();
      await entrar(page, baseUrl);
      await assentar(page);

      // ------------------------------------------------ O toque (capítulo 6): o cartão e o botão apertados
      const porta = page.getByRole("link", { name: "Criar" });
      await page.goto(`${baseUrl}/criar`);
      await assentar(page);
      const cartao = page.getByRole("button", { name: /Os temas de hoje/ });
      const caixaCartao = (await cartao.boundingBox())!;
      await page.mouse.move(caixaCartao.x + caixaCartao.width / 2, caixaCartao.y + caixaCartao.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(160);
      await foto("Toque", "CartaoApertado", page);
      await page.mouse.up({ button: "left" }).catch(() => {});
      await page.goto(`${baseUrl}/criar`);
      await assentar(page);
      void porta;

      // ------------------------------------------------ Entre telas (capítulo 3): a tela chegando por cima, no meio da entrada
      await page.getByRole("button", { name: /Os temas de hoje/ }).click();
      await page.waitForURL(/\/criar\/temas/);
      await page.waitForTimeout(110);
      await foto("EntreTelas", "Entrando", page);
      await assentar(page);

      // ------------------------------------------------ A folha (capítulo 4): subindo e arrastada
      await page.goto(`${baseUrl}/hoje`);
      await assentar(page);
      await page.getByRole("button", { name: /Mais:/ }).click();
      await page.waitForTimeout(120);
      await foto("Folha", "Subindo", page);
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
      const titulo = page.getByRole("dialog", { name: "Mais" }).getByRole("heading", { name: "Mais" });
      const caixaTitulo = (await titulo.boundingBox())!;
      await page.mouse.move(caixaTitulo.x + caixaTitulo.width / 2, caixaTitulo.y + caixaTitulo.height / 2);
      await page.mouse.down();
      await page.mouse.move(caixaTitulo.x + caixaTitulo.width / 2, caixaTitulo.y + 170, { steps: 10 });
      await foto("Folha", "Arrastada", page);
      await page.mouse.up();
      await page.waitForTimeout(500);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);

      // ------------------------------------------------ A espera (capítulo 5): "Atualizar" e "Já estava em dia"
      await page.goto(`${baseUrl}/hoje`);
      await assentar(page);
      await page.getByRole("button", { name: "Atualizar" }).click();
      await page.waitForTimeout(150);
      await foto("Espera", "Atualizando", page);
      await page.waitForTimeout(900);
      await foto("Espera", "JaEstavaEmDia", page);

      // ------------------------------------------------ Os seis estados do ramo (Conta)
      await page.goto(`${baseUrl}/conta`);
      await assentar(page);
      const campo = page.getByRole("combobox", { name: "Ramo" });
      await campo.scrollIntoViewIfNeeded();
      await foto("Ramo", "0Escolhido", page);
      await campo.fill("");
      await campo.click();
      await page.waitForTimeout(200);
      await foto("Ramo", "1Vazio", page);
      await campo.fill("limp");
      await page.waitForTimeout(250);
      await foto("Ramo", "2Buscando", page);
      await campo.fill("criação de abelhas");
      await page.waitForTimeout(250);
      await foto("Ramo", "3SemResultado", page);
      await page.getByRole("option", { name: /Não achei o meu/ }).click();
      await page.waitForTimeout(250);
      await foto("Ramo", "4NaoAchei", page);
      await campo.click();
      await campo.fill("");
      await page.getByRole("button", { name: "Ver a lista de ramos" }).click();
      await page.waitForTimeout(600);
      await esconderPortal(page);
      await foto("Ramo", "5FolhaOsRamos", page);

      await contexto.close();
    }
  } finally {
    await browser.close();
  }
  for (const arquivo of gravados) console.log(arquivo);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
