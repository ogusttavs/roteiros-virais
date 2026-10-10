/**
 * Capturas da E28 parte 4 ("Vozes do público" no admin do setor): a seção com a leitura que vale (com o que passou do piso e o que ficou de fora), com a leitura velha e no ramo sem leitura,
 * em 390 e 1280, claro e escuro. Nenhum dado de cliente: o ramo é o da limpeza do seed, e as vozes são inventadas. O script põe as vozes de exemplo no ramo, tira as fotos e devolve tudo como
 * estava.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e28-pr4.ts <nome-da-pasta>` (ex.: "pr-e28-4").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { nichos, videos, type VozDoPublico, type VozesDoSetor } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const USUARIO_DA_MARCA = "seed-cliente-limpeza";
const DIA_MS = 24 * 60 * 60 * 1000;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const posicao = getComputedStyle(el).position;
      // A barra do alto é "sticky": numa captura de página inteira ela cobre o título, e não existe na tela de verdade.
      if (posicao === "fixed" || posicao === "sticky") el.style.visibility = "hidden";
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

async function entrarComoAdmin(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e28-pr4.ts <nome-da-pasta> (ex.: "pr-e28-4")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO_DA_MARCA);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO_DA_MARCA}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const [setor] = await db().select({ slug: nichos.slug, vozes: nichos.vozes, vozesEm: nichos.vozesEm }).from(nichos).where(eq(nichos.id, marca.nichoId));
  const doSetor = await db().select({ id: videos.id }).from(videos).where(eq(videos.nichoId, marca.nichoId)).limit(3);
  const ids = doSetor.map((v) => v.id);

  const voz = (texto: string, vezes: number, quais: number[] = ids): VozDoPublico => ({ texto, vezes, videos: quais, plataformas: ["youtube"] });
  const vozes: VozesDoSetor = {
    duvidas: [
      voz("Serve em tecido de camurça?", 31),
      voz("Quanto tempo tem que esperar?", 24),
      voz("Pode usar em cor clara?", 19, ids.slice(0, 2)),
      voz("Estraga o tecido com o tempo?", 8, ids.slice(0, 1)),
      voz("Funciona em mancha antiga?", 4, ids.slice(0, 1)),
    ],
    objecoes: [voz("Não funciona em mancha antiga", 18), voz("É caro para o tamanho do frasco", 11, ids.slice(0, 2)), voz("Cheiro forte demais", 3, ids.slice(0, 1))],
    pedidos: [voz("Faz um mostrando em tapete", 15), voz("Mostra em mancha de gordura", 9, ids.slice(0, 2))],
    videos: 10,
    comentarios: 984,
    plataformas: ["youtube"],
  };

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (estado: string) => path.join(pastaDestino, `AdminNicho.VozesDoPublico.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrarComoAdmin(page, baseUrl);

        const casos = [
          { estado: "Vale", vozes, vozesEm: new Date(Date.now() - 2 * DIA_MS) },
          { estado: "Velha", vozes, vozesEm: new Date(Date.now() - 20 * DIA_MS) },
          { estado: "Sem", vozes: null, vozesEm: null },
        ];
        for (const caso of casos) {
          await db().update(nichos).set({ vozes: caso.vozes, vozesEm: caso.vozesEm }).where(eq(nichos.id, marca.nichoId));
          await page.goto(`${baseUrl}/admin/nichos/${setor.slug}`);
          const secao = page.locator("[data-vozes-do-publico]");
          await secao.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          const foto = nomeDe(caso.estado);
          await fotografarElemento(page, secao, foto);
          gravados.push(foto);
        }
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().update(nichos).set({ vozes: setor.vozes ?? null, vozesEm: setor.vozesEm ?? null }).where(eq(nichos.id, marca.nichoId));
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
