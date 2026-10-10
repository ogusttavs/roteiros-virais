/**
 * Capturas do PR 2a da E55 (o cartão "Em alta hoje" no Hoje e no Planejar): o cartão sem roteiro, com o roteiro criado dentro dele, com o menu aberto (sem "Não vou gravar hoje") e a visão Semana
 * do Planejar com o item do momento, em 390 e 1280, claro e escuro. Nenhum dado de cliente: a marca é a da limpeza do seed. O script põe um assunto em alta de exemplo (duas rodadas de
 * tendências e o tema do momento nos temas de hoje do ramo), tira as fotos, e devolve tudo como estava.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e55-pr2a.ts <nome-da-pasta>` (ex.: "pr-147").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, like, sql } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros, temasDia, tendenciasBrasil, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const HORA = 60 * 60 * 1000;

const ASSUNTO = "Frente fria";
const PREFIXO_DA_RODADA = "Captura em alta";
const TITULO_DO_TEMA = "O mofo que a frente fria traz para o armário, e como tirar hoje";
const TITULO_DO_ROTEIRO = "Mofo no armário: o que fazer hoje";

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

/** Esconde o portal e tudo o que é fixo (as barras ficam por cima do recorte). */
async function limparTela(page: Page): Promise<void> {
  await esconderPortal(page);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
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
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e55-pr2a.ts <nome-da-pasta> (ex.: "pr-147")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const hoje = hojeISO();

  // O estado de antes, para devolver: os temas de hoje do ramo (se havia) e nenhuma rodada nossa.
  const [antes] = await db().select().from(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));
  const agora = Date.now();
  const termos = [ASSUNTO, "frio"];
  const chave = ASSUNTO.toLowerCase();
  await db()
    .insert(tendenciasBrasil)
    .values(
      [agora - 8 * HORA, agora - 60_000].map((quando) => ({
        coletadaEm: new Date(quando),
        assunto: ASSUNTO,
        chave,
        termos,
        fontes: [
          { fonte: "google" as const, titulo: `${PREFIXO_DA_RODADA}: ${ASSUNTO}`, url: null, trafego: "20000+", posicao: 1 },
          { fonte: "youtube" as const, titulo: `${PREFIXO_DA_RODADA}: previsão do frio`, url: null, trafego: null, posicao: 3 },
        ],
        posicao: 1,
        sensivel: false,
      })),
    );
  const doMomento = { chave, assunto: ASSUNTO, termos, fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date(agora - 60_000).toISOString(), encaixe: 9 };
  const temaComum: TemaDoDia = { titulo: "O erro que faz a mancha voltar depois da limpeza", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
  const temaMomento: TemaDoDia = {
    titulo: TITULO_DO_TEMA,
    descricao: "Curto e fácil de gravar: 30 segundos, no celular, na frente do armário.",
    porQue: "p",
    evidencias: [],
    puxaPara: "alcance",
    doMomento,
  };
  await db().delete(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));
  await db().insert(temasDia).values({ nichoId: marca.nichoId, data: hoje, temas: [temaComum, temaMomento] });

  const conteudo = {
    titulo: TITULO_DO_ROTEIRO,
    duracaoS: 30,
    gancho: "Esfriou ontem e hoje o armário já cheira a guardado? É o mofo começando.",
    corpo: "Abra o armário e mostre a parede do fundo.",
    fechamento: "Mostre o armário arejado.",
    chamadaFinal: "Me manda uma foto que eu te digo o que usar.",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "na frente do armário",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
  };

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrar(page, baseUrl);

        // 1. o cartão, ainda sem roteiro
        await db().delete(roteiros).where(and(eq(roteiros.clienteId, marca.id), like(roteiros.tema, `${TITULO_DO_TEMA}%`)));
        await page.goto(`${baseUrl}/hoje`);
        const secao = page.locator('section[aria-labelledby="t-em-alta"]');
        await secao.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const semRoteiro = nomeDe("Hoje", "EmAlta");
        await fotografarElemento(page, secao, semRoteiro);
        gravados.push(semRoteiro);

        // 2. o roteiro criado, dentro do cartão, e o menu aberto
        await db().insert(roteiros).values({
          clienteId: marca.id,
          data: hoje,
          tema: TITULO_DO_TEMA,
          origem: "sugerido",
          objetivo: "alcance",
          formato: "reels",
          conteudo,
          status: "gerado",
          temaDoMomento: { chave, assunto: ASSUNTO, termos, fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date(agora - 60_000).toISOString() },
        });
        await page.goto(`${baseUrl}/hoje`);
        await secao.getByRole("button", { name: "Abrir o roteiro" }).waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const criado = nomeDe("Hoje", "EmAltaCriado");
        await fotografarElemento(page, secao, criado);
        gravados.push(criado);

        await secao.getByRole("button", { name: `Mais opções: ${TITULO_DO_TEMA}` }).click();
        await page.getByRole("menuitem", { name: "Arquivar" }).waitFor({ state: "visible" });
        await esconderPortal(page);
        await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
        const menu = nomeDe("Hoje", "EmAltaMenu");
        await page.screenshot({ path: menu });
        gravados.push(menu);

        // 3. o Planejar, visão Semana: o item do momento no dia de hoje
        await page.goto(`${baseUrl}/planejamento?visao=semana`);
        await page.getByText(TITULO_DO_ROTEIRO).first().waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        await limparTela(page);
        const semana = nomeDe("Planejar", "SemanaDoMomento");
        await page.screenshot({ path: semana });
        gravados.push(semana);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(roteiros).where(and(eq(roteiros.clienteId, marca.id), like(roteiros.tema, `${TITULO_DO_TEMA}%`)));
    await db().delete(tendenciasBrasil).where(sql`${tendenciasBrasil.fontes}::text like ${`%${PREFIXO_DA_RODADA}%`}`);
    await db().delete(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));
    if (antes) await db().insert(temasDia).values({ nichoId: marca.nichoId, data: hoje, temas: antes.temas });
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
