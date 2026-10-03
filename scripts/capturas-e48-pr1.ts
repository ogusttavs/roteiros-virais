/**
 * Capturas do PR 1 da E48 (o convite de instalar o aplicativo no celular): a folha no Android (com o botão) e no iPhone (os dois passos), o cartão
 * da Conta com o botão no Android, e o computador sem convite nenhum (1280, só para provar), claro e escuro. Nenhum dado de cliente: a marca é a
 * do seed.
 *
 * O roteiro das capturas é gravado direto no banco uma vez (a geração pela tela em mock demora mais de um minuto, e o convite só olha a tela do roteiro). Cada combinação zera o
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
import { preferenciasUsuario, roteiros, user } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

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

/** Esconde o portal do Next em desenvolvimento (o selo "N" no canto). */
async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
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

    // O primeiro roteiro, gravado direto no banco (a geração pela tela em mock demora mais de um minuto): o convite só olha a tela do roteiro.
    const [marca] = await marcasDoUsuario(USUARIO);
    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: marca.id,
        data: hojeISO(),
        tema: "organizar os recibos do mês",
        origem: "livre",
        objetivo: "alcance",
        status: "gerado",
        conteudo: {
          titulo: "Os recibos do mês em 40 segundos",
          duracaoS: 40,
          gancho: "Esta pilha de notas fiscais virou uma planilha em quarenta segundos.",
          corpo: "Mostro a pilha, passo uma por uma e digo o total no fim.",
          fechamento: "No fim do mês é só somar a coluna.",
          chamadaFinal: "Comenta qual recibo você nunca acha.",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "na mesa do escritório",
          edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: true,
          forcaEvidencia: null,
        } as never,
      })
      .returning();
    const urlRoteiro = `${baseUrl}/roteiros/${roteiro.id}`;

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
        await page.waitForTimeout(1500);
        await dispararPedidoDeInstalacao(page);
        await page.getByRole("dialog", { name: "Coloque o aplicativo na tela de início" }).waitFor({ state: "visible", timeout: 10_000 });
        await page.getByRole("button", { name: "Adicionar ao celular" }).waitFor({ state: "visible" });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
        const arquivo = nomeDe("Roteiro.ConviteInstalar", "Android", "390");
        await esconderPortal(page);
        await page.screenshot({ path: arquivo });
        gravados.push(arquivo);

        // A Conta, com o mesmo botão no cartão.
        await page.getByRole("button", { name: "Agora não" }).click();
        await page.goto(`${baseUrl}/conta`);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);
        await dispararPedidoDeInstalacao(page);
        const cartao = page.getByTestId("instalar-no-celular");
        await cartao.getByRole("button", { name: "Adicionar ao celular" }).waitFor({ state: "visible" });
        await cartao.scrollIntoViewIfNeeded();
        const conta = nomeDe("Conta.InstalarNoCelular", "Android", "390");
        await esconderPortal(page);
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
        await esconderPortal(page);
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
        await esconderPortal(page);
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
