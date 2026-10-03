/**
 * Capturas do A2 (itens 6, 7 e 8): a cápsula de baixo em Criar (a aba ativa acesa, o "Mais" sem fundo de botão), "Stories de hoje" em Hoje com e sem Story
 * marcado (o botão "Criar um Story para hoje"), e a folha "Mais" com "Conta e ajustes", em 390, claro e escuro. Nenhum dado de cliente: a marca é a do seed.
 *
 * O Story do estado "com Story" é gravado no banco e apagado ao fim; os roteiros de hoje da marca do seed são tirados do caminho (e devolvidos) no estado "sem Story".
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`,
 * `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-a2.ts <nome-da-pasta>` (ex.: "pr-115").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;

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

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await esconderPortal(page);
  await alvo.scrollIntoViewIfNeeded();
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  await page.screenshot({ path: arquivo, clip: { x: Math.max(0, caixa.x - 8), y: Math.max(0, caixa.y - 8), width: Math.min(390, caixa.width + 16), height: caixa.height + 16 } });
}

const CONTEUDO = {
  titulo: "Os recibos do mês em 15 segundos",
  duracaoS: 15,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na mesa do escritório",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-a2.ts <nome-da-pasta> (ex.: "pr-115")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca) throw new Error('cliente de seed nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).');
  const hoje = hojeISO();

  async function limparStoriesDeHoje(): Promise<void> {
    await db().delete(roteiros).where(and(eq(roteiros.clienteId, marca.id), eq(roteiros.data, hoje), eq(roteiros.formato, "story")));
  }

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.390.${modo.rotulo}.png`);
      const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: modo.colorScheme, isMobile: true, hasTouch: true });
      const page = await contexto.newPage();
      await entrar(page, baseUrl);

      // ---------------------------------------------------------------- A cápsula, em Criar (item 6)
      await page.goto(`${baseUrl}/criar`);
      const capsula = page.getByRole("navigation", { name: "Navegação principal" });
      await capsula.waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle");
      await esconderPortal(page);
      const arquivoCapsula = nomeDe("Capsula", "EmCriar");
      const caixa = await capsula.boundingBox();
      if (!caixa) throw new Error("cápsula sem caixa");
      await page.screenshot({ path: arquivoCapsula, clip: { x: 0, y: Math.max(0, caixa.y - 24), width: 390, height: Math.min(844 - Math.max(0, caixa.y - 24), caixa.height + 48) } });
      gravados.push(arquivoCapsula);

      // ---------------------------------------------------------------- A folha Mais, com Conta e ajustes (item 8)
      await page.getByRole("button", { name: /Mais:/ }).click();
      const folha = page.getByRole("dialog", { name: "Mais" });
      await folha.waitFor({ state: "visible" });
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
      await esconderPortal(page);
      const arquivoMais = nomeDe("FolhaMais", "ComConta");
      await page.screenshot({ path: arquivoMais });
      gravados.push(arquivoMais);
      await page.keyboard.press("Escape");

      // ---------------------------------------------------------------- Stories de hoje, sem e com Story (item 7)
      for (const estado of ["SemStory", "ComStory"]) {
        await limparStoriesDeHoje();
        if (estado === "ComStory") {
          await db()
            .insert(roteiros)
            .values({
              clienteId: marca.id,
              data: hoje,
              tema: "organizar os recibos",
              origem: "sugerido",
              objetivo: "engajamento",
              formato: "story",
              momentoDoDia: "manha",
              conteudo: CONTEUDO as never,
              status: "gerado",
            });
        }
        await page.goto(`${baseUrl}/hoje`);
        const secao = page.locator("section", { has: page.getByRole("heading", { name: "Stories de hoje" }) });
        const naColuna = secao.getByRole("button", { name: "Criar um Story para hoje" });
        // Dia sem nada marcado: o botão está no cartão do dia livre, não na coluna.
        const alvo = (await naColuna.count()) > 0 ? secao : page.locator("section", { has: page.getByRole("button", { name: "Criar um Story para hoje" }) }).first();
        await alvo.getByRole("button", { name: "Criar um Story para hoje" }).waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const arquivo = nomeDe("Hoje.StoriesDeHoje", estado);
        await fotografarElemento(page, alvo, arquivo);
        gravados.push(arquivo);
      }
      await contexto.close();
    }
  } finally {
    await limparStoriesDeHoje().catch(() => undefined);
    await browser.close();
    await getPool().end();
  }
  console.log(`${gravados.length} capturas em ${pastaDestino}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
