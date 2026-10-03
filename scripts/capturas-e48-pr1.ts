/**
 * Capturas do PR 1 da E48 (o convite de instalar o aplicativo no celular): a folha no Android (com o botão) e no iPhone (os dois passos), o cartão
 * da Conta com o botão no Android, e o computador sem convite nenhum (1280, só para provar), claro e escuro. Nenhum dado de cliente: a marca é a
 * do seed.
 *
 * O primeiro roteiro é gerado pela tela de verdade (Gravar agora, em mock) uma vez; as outras capturas reabrem esse roteiro. Cada combinação zera o
 * "agora não" e a data de instalação da pessoa antes de entrar (e ao fim), para o convite aparecer.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`,
 * `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e48-pr1.ts <nome-da-pasta>` (ex.: "pr-113").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { preferenciasUsuario, user } from "../src/db/schema";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;

const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
  await page.waitForLoadState("networkidle");
}

async function zerarPreferencias(): Promise<void> {
  const [pessoa] = await db().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
  if (!pessoa) throw new Error('cliente de seed nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).');
  await db()
    .update(preferenciasUsuario)
    .set({ conviteInstalarAdiadoAte: null, instaladoEm: null })
    .where(eq(preferenciasUsuario.usuarioId, pessoa.id));
}

async function dispararPedidoDeInstalacao(page: Page): Promise<void> {
  await page.evaluate(() => {
    const evento = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
    evento.prompt = async () => undefined;
    evento.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(evento);
  });
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e48-pr1.ts <nome-da-pasta> (ex.: "pr-113")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    await zerarPreferencias();

    // O primeiro roteiro, pela tela (no computador, onde o convite não aparece).
    const contextoInicial = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const paginaInicial = await contextoInicial.newPage();
    await entrar(paginaInicial, baseUrl);
    await paginaInicial.goto(`${baseUrl}/criar`);
    await paginaInicial.getByRole("button", { name: "Contar o momento" }).click();
    const folha = paginaInicial.getByRole("dialog", { name: "Gravar agora" });
    await folha.waitFor({ state: "visible" });
    await folha.getByLabel("Onde você está").fill("no escritório, hora do almoço");
    await folha.getByLabel("O que está acontecendo").fill("organizando os recibos do mês de um cliente");
    await folha.getByLabel("O que dá para mostrar").fill("a planilha e a pilha de notas fiscais");
    await folha.getByRole("radio", { name: "Mais gente me conhecer" }).click();
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await paginaInicial.waitForURL(/\/roteiros\/\d+/, { timeout: 120_000 });
    const urlRoteiro = paginaInicial.url();
    await contextoInicial.close();

    for (const modo of MODOS) {
      const nomeDe = (tela: string, estado: string, largura: string) => path.join(pastaDestino, `${tela}.${estado}.${largura}.${modo.rotulo}.png`);
      const celular = (userAgent: string) =>
        browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: modo.colorScheme, userAgent, isMobile: true, hasTouch: true });

      // ---------------------------------------------------------------- Android: a folha com o botão
      {
        await zerarPreferencias();
        const contexto = await celular(UA_ANDROID);
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(urlRoteiro);
        await page.waitForLoadState("networkidle");
        await dispararPedidoDeInstalacao(page);
        await page.getByRole("dialog", { name: "Coloque o aplicativo na tela de início" }).waitFor({ state: "visible", timeout: 10_000 });
        await page.getByRole("button", { name: "Adicionar ao celular" }).waitFor({ state: "visible" });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
        const arquivo = nomeDe("Roteiro.ConviteInstalar", "Android", "390");
        await page.screenshot({ path: arquivo });
        gravados.push(arquivo);

        // A Conta, com o mesmo botão no cartão.
        await page.getByRole("button", { name: "Agora não" }).click();
        await page.goto(`${baseUrl}/conta`);
        await dispararPedidoDeInstalacao(page);
        const cartao = page.getByTestId("instalar-no-celular");
        await cartao.getByRole("button", { name: "Adicionar ao celular" }).waitFor({ state: "visible" });
        await cartao.scrollIntoViewIfNeeded();
        const conta = nomeDe("Conta.InstalarNoCelular", "Android", "390");
        await page.screenshot({ path: conta });
        gravados.push(conta);
        await contexto.close();
      }

      // ---------------------------------------------------------------- iPhone: os dois passos
      {
        await zerarPreferencias();
        const contexto = await celular(UA_IPHONE);
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(urlRoteiro);
        await page.getByRole("dialog", { name: "Coloque o aplicativo na tela de início" }).waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
        const arquivo = nomeDe("Roteiro.ConviteInstalar", "iPhone", "390");
        await page.screenshot({ path: arquivo });
        gravados.push(arquivo);
        await contexto.close();
      }

      // ---------------------------------------------------------------- Computador: sem convite (só para provar)
      {
        await zerarPreferencias();
        const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(urlRoteiro);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);
        if ((await page.getByRole("dialog", { name: "Coloque o aplicativo na tela de início" }).count()) > 0) throw new Error("o convite apareceu no computador");
        const arquivo = nomeDe("Roteiro.ConviteInstalar", "SemConviteNoComputador", "1280");
        await page.screenshot({ path: arquivo });
        gravados.push(arquivo);
        await contexto.close();
      }
    }
  } finally {
    await zerarPreferencias().catch(() => undefined);
    await browser.close();
    await getPool().end();
  }
  console.log(`${gravados.length} capturas em ${pastaDestino}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
