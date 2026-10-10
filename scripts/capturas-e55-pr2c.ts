/**
 * Capturas do PR 2c da E55 (o assunto do momento no admin), em 1024 e 1280, claro e escuro: a lista de Ramos com a linha "1 do momento: <assunto>" embaixo da última leitura do ramo, e o cartão da rotina "Montar os temas
 * do dia" com o fim da frase ("Hoje, N ramos com tema do momento."). O push e o e-mail não têm captura (são texto; a prova é o teste de integração). O script põe um assunto em alta de exemplo no ramo da limpeza do seed,
 * tira as fotos, e devolve tudo como estava.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e55-pr2c.ts <nome-da-pasta>` (ex.: "pr-149").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { execucoesJob, nichos, temasDia, tendenciasBrasil, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_SEED = "ExemploSenha123";
const ASSUNTO = "Frente fria";

const TAMANHOS = [
  { rotulo: "1024", largura: 1024, altura: 800 },
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
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
}

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await alvo.scrollIntoViewIfNeeded();
  await alvo.screenshot({ path: arquivo });
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e55-pr2c.ts <nome-da-pasta> (ex.: "pr-149")');
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const hoje = hojeISO();
  const [limpeza] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  if (!limpeza) throw new Error('ramo "limpeza-e-organizacao-da-casa" do seed nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).');
  const [antes] = await db().select().from(temasDia).where(and(eq(temasDia.nichoId, limpeza.id), eq(temasDia.data, hoje)));

  const chave = ASSUNTO.toLowerCase();
  const rodadaEm = new Date(Date.now() - 60_000);
  const temaComum: TemaDoDia = { titulo: "O erro que faz a mancha voltar depois da limpeza", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
  const temaMomento: TemaDoDia = {
    titulo: "O mofo que a frente fria traz para o armário, e como tirar hoje",
    descricao: "Curto e fácil de gravar.",
    porQue: "o frio junta umidade onde o ar não passa",
    evidencias: [],
    puxaPara: "alcance",
    doMomento: { chave, assunto: ASSUNTO, termos: [ASSUNTO], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: rodadaEm.toISOString(), encaixe: 9 },
  };
  await db().delete(temasDia).where(and(eq(temasDia.nichoId, limpeza.id), eq(temasDia.data, hoje)));
  await db().insert(temasDia).values({ nichoId: limpeza.id, data: hoje, temas: [temaComum, temaMomento] });
  await db().insert(tendenciasBrasil).values({ coletadaEm: rodadaEm, assunto: ASSUNTO, chave, termos: [ASSUNTO], fontes: [{ fonte: "google", titulo: ASSUNTO, url: null, trafego: "20000+", posicao: 1 }], posicao: 1, sensivel: false });
  const [execucao] = await db()
    .insert(execucoesJob)
    .values({ nome: "temas-do-dia", status: "ok", terminadoEm: new Date(), resumo: { nichos: 2, semUso: 0 } })
    .returning({ id: execucoesJob.id });

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string) => path.join(pastaDestino, `${tela}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await page.goto(`${baseUrl}/entrar`);
        await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
        await page.getByLabel("Senha").fill(SENHA_SEED);
        await page.getByRole("button", { name: "entrar", exact: true }).click();
        await page.waitForLoadState("networkidle");

        await page.goto(`${baseUrl}/admin/nichos`);
        await page.locator("[data-do-momento]").first().waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const ramos = nomeDe("AdminNichos.Normal");
        await fotografarElemento(page, page.locator("table").first(), ramos);
        gravados.push(ramos);

        await page.goto(`${baseUrl}/admin/jobs`);
        const cartao = page.locator('[data-rotina="temas"]');
        await cartao.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const rotina = nomeDe("AdminJobs.Normal");
        await fotografarElemento(page, cartao, rotina);
        gravados.push(rotina);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(execucoesJob).where(eq(execucoesJob.id, execucao.id));
    await db().delete(tendenciasBrasil).where(inArray(tendenciasBrasil.coletadaEm, [rodadaEm]));
    await db().delete(temasDia).where(and(eq(temasDia.nichoId, limpeza.id), eq(temasDia.data, hoje)));
    if (antes) await db().insert(temasDia).values({ nichoId: limpeza.id, data: hoje, temas: antes.temas });
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
