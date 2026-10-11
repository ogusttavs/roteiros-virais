/**
 * Capturas da E52 parte 1 ("Vídeos longos do YouTube" no admin do setor): a seção com a medida (indício), com os longos da janela e com a lista de capítulos, e o ramo sem nenhum longo,
 * em 390 e 1280, claro e escuro. Nenhum dado de cliente: o ramo é o da limpeza do seed e os vídeos são inventados e marcados "[exemplo]". O script escreve os vídeos de exemplo no banco
 * (nenhuma coleta, nenhuma IA), tira as fotos e apaga o que criou.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr1.ts <nome-da-pasta>` (ex.: "pr-e52-1").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { nichos, videos } from "../src/db/schema";
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
      if ((posicao === "fixed" || posicao === "sticky") && !el.closest("table")) el.style.visibility = "hidden";
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

function lista(...inicios: number[]): string {
  const nomes = ["Abertura", "O erro mais comum", "Como fazer do jeito certo", "O que usar", "Fechamento", "Perguntas"];
  return ["Neste vídeo eu mostro o passo a passo completo.", "", ...inicios.map((s, i) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} ${nomes[i % nomes.length]}`)].join("\n");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr1.ts <nome-da-pasta> (ex.: "pr-e52-1")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO_DA_MARCA);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO_DA_MARCA}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const [setor] = await db().select({ slug: nichos.slug }).from(nichos).where(inArray(nichos.id, [marca.nichoId]));
  const [ramoVazio] = await db().insert(nichos).values({ slug: `captura-e52-sem-longo`, nome: "[exemplo] Ramo sem vídeo longo", termos: [] }).returning();

  const agora = Date.now();
  const exemplos = [
    { id: "cap-e52-1", titulo: "[exemplo] Como tirar mancha do sofá sem estragar o tecido", s: 612, views: 482_000, dias: 3, descricao: lista(0, 70, 190, 330, 480, 560) },
    { id: "cap-e52-2", titulo: "[exemplo] 7 erros ao limpar o estofado", s: 540, views: 360_000, dias: 6, descricao: lista(0, 90, 210, 400) },
    { id: "cap-e52-3", titulo: "[exemplo] Limpeza de tapete: o passo a passo de quem faz todo dia", s: 905, views: 275_000, dias: 9, descricao: lista(0, 120, 300, 520, 700, 820) },
    { id: "cap-e52-4", titulo: "[exemplo] Produto caseiro funciona mesmo?", s: 430, views: 190_000, dias: 14, descricao: null },
    { id: "cap-e52-5", titulo: "[exemplo] Bastidores de um dia de limpeza pós-obra", s: 1320, views: 120_000, dias: 21, descricao: lista(0, 180, 420, 800, 1100) },
  ];

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    await db()
      .insert(videos)
      .values(
        exemplos.map((e, i) => ({
          plataforma: "youtube" as const,
          idExterno: e.id,
          url: `https://exemplo.invalido/${e.id}`,
          nichoId: marca.nichoId!,
          titulo: e.titulo,
          descricao: e.descricao,
          views: e.views,
          duracaoS: e.s,
          foraDaCurva: String(8 - i),
          publicadoEm: new Date(agora - e.dias * DIA_MS),
          idioma: "pt",
          origem: "coleta" as const,
          transcricao: i === 0 ? "[exemplo] texto lido" : null,
          transcritoEm: i === 0 ? new Date(agora - DIA_MS) : null,
        })),
      );

    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrarComoAdmin(page, baseUrl);

        for (const caso of [
          { estado: "Indicio", slug: setor.slug },
          { estado: "Vazio", slug: ramoVazio.slug },
        ]) {
          await page.goto(`${baseUrl}/admin/nichos/${caso.slug}`);
          const secao = page.locator("[data-longos-do-setor]");
          await secao.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          const foto = path.join(pastaDestino, `AdminNicho.VideosLongos.${caso.estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
          await fotografarElemento(page, secao, foto);
          gravados.push(foto);
        }
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(videos).where(inArray(videos.idExterno, exemplos.map((e) => e.id)));
    await db().delete(nichos).where(inArray(nichos.id, [ramoVazio.id]));
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
