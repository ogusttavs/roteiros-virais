/**
 * Capturas do PR 2b da E55 (o assunto em alta no Criar, na porta dos temas, no Tema livre, no Roteiro e no Histórico), em 390 e 1280, claro e escuro: o cartão no alto do Criar, a lista do que não coube no
 * ramo, os temas de hoje com o cartão, o Tema livre com o assunto preso, o roteiro do momento (ainda em alta e já passou) e o Histórico com o selo. Nenhum dado de cliente: a marca é a da limpeza do
 * seed. O script põe um assunto em alta de exemplo, tira as fotos, e devolve tudo como estava.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e55-pr2b.ts <nome-da-pasta>` (ex.: "pr-148").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros, temasDia, tendenciasAvaliadas, tendenciasBrasil, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const HORA = 60 * 60 * 1000;

const ASSUNTO = "Frente fria";
const CHAVE = "frente fria";
const TITULO_DO_TEMA = "O mofo que a frente fria traz para o armário, e como tirar hoje";
const TITULO_DO_ROTEIRO = "Mofo no armário: o que fazer hoje";
const LIGACAO = "o frio junta umidade onde o ar não passa, e o mofo aparece no armário";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const CONTEUDO = {
  titulo: TITULO_DO_ROTEIRO,
  duracaoS: 30,
  gancho: "Esfriou ontem e hoje o armário já cheira a guardado? É o mofo começando.",
  corpo: "Abra o armário e mostre a parede do fundo e a roupa encostada nela. Tire a roupa de perto da parede, passe o produto num pano, nunca direto, e deixe a porta aberta por uma hora.",
  fechamento: "Mostre o armário arejado.",
  chamadaFinal: "Se o cheiro voltar em dois dias, me manda uma foto que eu te digo o que usar.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na frente do armário",
  edicao: {
    textoNaTela: [{ quando: "0 a 2 s", onde: "no topo", oQue: "esfriou e o armário cheira a guardado?" }],
    ritmoDeCorte: "rápido, um corte a cada 3 segundos",
    recursos: ["a lanterna do celular apontada para o fundo do armário"],
    audio: null,
    referencia: null,
  },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

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

async function fotografarTela(page: Page, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: arquivo, fullPage: true });
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

type Linha = { assunto: string; termos?: string[]; fonte?: "google" | "youtube"; trafego?: string | null; sensivel?: boolean };

async function rodada(quando: Date, linhas: Linha[]): Promise<void> {
  await db()
    .insert(tendenciasBrasil)
    .values(
      linhas.map((l, i) => ({
        coletadaEm: quando,
        assunto: l.assunto,
        chave: l.assunto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim(),
        termos: l.termos ?? [l.assunto],
        fontes: [{ fonte: l.fonte ?? ("google" as const), titulo: l.assunto.toLowerCase(), url: null, trafego: l.trafego === undefined ? "20000+" : l.trafego, posicao: i + 1 }],
        posicao: i + 1,
        sensivel: l.sensivel ?? false,
      })),
    );
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e55-pr2b.ts <nome-da-pasta> (ex.: "pr-148")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const hoje = hojeISO();

  // O estado de antes, para devolver: os temas de hoje do ramo (se havia).
  const [antes] = await db().select().from(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));
  const agora = Date.now();
  const rodadaAntes = new Date(agora - 8 * HORA);
  const rodadaAgora = new Date(agora - 60_000);
  const termos = [ASSUNTO, "frio"];

  const doMomento = { chave: CHAVE, assunto: ASSUNTO, termos, fonte: "Em alta no Google no Brasil", url: null, coletadaEm: rodadaAgora.toISOString(), encaixe: 9 };
  const temaComum: TemaDoDia = { titulo: "O erro que faz a mancha voltar depois da limpeza", descricao: "d", porQue: "o cliente vê a mancha voltar e acha que o produto não presta", evidencias: [], puxaPara: "alcance" };
  const temaMomento: TemaDoDia = {
    titulo: TITULO_DO_TEMA,
    descricao: "Curto e fácil de gravar: 30 segundos, no celular, na frente do armário.",
    porQue: LIGACAO,
    evidencias: [],
    puxaPara: "alcance",
    doMomento,
  };

  async function porTemas(comMomento: boolean): Promise<void> {
    await db().delete(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId!), eq(temasDia.data, hoje)));
    await db().insert(temasDia).values({ nichoId: marca.nichoId!, data: hoje, temas: comMomento ? [temaComum, temaMomento] : [temaComum] });
  }
  async function limparRoteiros(): Promise<void> {
    await db().delete(roteiros).where(and(eq(roteiros.clienteId, marca.id), like(roteiros.tema, `${TITULO_DO_TEMA}%`)));
  }
  async function inserirRoteiro(data: string, ligacao: string | null): Promise<number> {
    const [linha] = await db()
      .insert(roteiros)
      .values({
        clienteId: marca.id,
        data,
        tema: TITULO_DO_TEMA,
        origem: "sugerido",
        objetivo: "alcance",
        formato: "reels",
        conteudo: CONTEUDO,
        status: "gerado",
        temaDoMomento: { chave: CHAVE, assunto: ASSUNTO, termos, fonte: "Em alta no Google no Brasil", url: null, coletadaEm: rodadaAgora.toISOString(), ligacao },
      })
      .returning({ id: roteiros.id });
    return linha.id;
  }

  // As rodadas: a de 8 horas atrás e a de agora, com o assunto nas duas (o "desde" é o da primeira), e mais assuntos para a lista do que não coube.
  await rodada(rodadaAntes, [{ assunto: ASSUNTO, termos }]);
  await rodada(rodadaAgora, [
    { assunto: ASSUNTO, termos },
    { assunto: "Final da Copa do Brasil", fonte: "youtube", trafego: null },
    { assunto: "Eleições 2026", termos: ["eleição"], sensivel: true },
    { assunto: "Estreia da novela das nove" },
    { assunto: "Desfile de 7 de Setembro" },
  ]);

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

        // 1. o Criar com o cartão no alto, e a porta dos temas com o cartão
        await limparRoteiros();
        await porTemas(true);
        await db().delete(tendenciasAvaliadas).where(eq(tendenciasAvaliadas.nichoId, marca.nichoId));
        await page.goto(`${baseUrl}/criar`);
        await page.locator("[data-em-alta]").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const criar = nomeDe("Criar", "EmAlta");
        await fotografarTela(page, criar);
        gravados.push(criar);

        await page.goto(`${baseUrl}/criar/temas`);
        await page.locator("[data-em-alta]").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const temas = nomeDe("Temas", "EmAlta");
        await fotografarTela(page, temas);
        gravados.push(temas);

        // 2. o Tema livre com o assunto preso
        await page.goto(`${baseUrl}/criar/tema-livre?alta=${encodeURIComponent(CHAVE)}`);
        await page.locator("[data-assunto-preso]").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const livre = nomeDe("TemaLivre", "ComAlta");
        await fotografarTela(page, livre);
        gravados.push(livre);

        // 3. o Criar sem tema do momento e com o setor "sem encaixe": a lista do que não coube
        await porTemas(false);
        await db().insert(tendenciasAvaliadas).values({ nichoId: marca.nichoId, rodadaEm: rodadaAgora, resultado: "sem_encaixe" }).onConflictDoNothing();
        await page.goto(`${baseUrl}/criar`);
        await page.locator("[data-sem-encaixe]").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const semEncaixe = nomeDe("Criar", "SemEncaixe");
        await fotografarElemento(page, page.locator("[data-sem-encaixe]"), semEncaixe);
        gravados.push(semEncaixe);
        await db().delete(tendenciasAvaliadas).where(eq(tendenciasAvaliadas.nichoId, marca.nichoId));

        // 4. o roteiro do momento, ainda em alta
        await porTemas(true);
        await limparRoteiros();
        const idVivo = await inserirRoteiro(hoje, LIGACAO);
        await page.goto(`${baseUrl}/roteiros/${idVivo}`);
        await page.locator("[data-selo-momento='vivo']").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const vivo = nomeDe("Roteiro", "DoMomento");
        await fotografarTela(page, vivo);
        gravados.push(vivo);

        // 5. o mesmo roteiro depois que o assunto saiu da lista (uma rodada nova, sem ele)
        const rodadaNova = new Date(Date.now() - 30_000);
        await rodada(rodadaNova, [{ assunto: "Jogo do Flamengo" }]);
        await page.goto(`${baseUrl}/roteiros/${idVivo}`);
        await page.locator("[data-selo-momento='passou']").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const passou = nomeDe("Roteiro", "MomentoPassou");
        await fotografarTela(page, passou);
        gravados.push(passou);

        // 6. o Histórico com o selo
        await page.goto(`${baseUrl}/historico`);
        await page.locator("[data-selo-do-momento]").first().waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const historico = nomeDe("Historico", "Selo");
        await fotografarTela(page, historico);
        gravados.push(historico);

        await db().delete(tendenciasBrasil).where(and(eq(tendenciasBrasil.assunto, "Jogo do Flamengo")));
        await limparRoteiros();
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await limparRoteiros();
    await db().delete(tendenciasAvaliadas).where(eq(tendenciasAvaliadas.nichoId, marca.nichoId));
    await db().delete(tendenciasBrasil).where(inArray(tendenciasBrasil.coletadaEm, [rodadaAntes, rodadaAgora]));
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
