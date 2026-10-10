/**
 * Capturas da E28 parte 3 ("O que o público pergunta", passo 25 do Opus): o bloco depois dos três temas (a porta "Os temas de hoje"), a quinta porta do Criar (com as perguntas e no estado
 * calmo de "ainda sem perguntas"), a linha fechada e o bloco aberto das Referências, e o Tema livre com a pergunta presa (pergunta e reclamação), em 390 e 1280, claro e escuro. Nenhum dado de
 * cliente: a marca é a da limpeza do seed, e as perguntas são inventadas. O script põe as vozes de exemplo no ramo da marca, tira as fotos e devolve tudo como estava.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e28-pr3.ts <nome-da-pasta>` (ex.: "pr-163").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { nichos, temasDia, type TemaDoDia, type VozDoPublico, type VozesDoSetor } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";
import { chaveDaVoz } from "../src/servicos/vozes-do-publico";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;

const PERGUNTA = "Serve em tecido de camurça?";
const RECLAMACAO = "A mancha voltou depois de secar";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const voz = (texto: string, vezes: number): VozDoPublico => ({ texto, vezes, videos: [1, 2, 3], plataformas: ["youtube"] });

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
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e28-pr3.ts <nome-da-pasta> (ex.: "pr-163")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const hoje = hojeISO();

  // O estado de antes, para devolver: as vozes do ramo e os temas de hoje.
  const [setorAntes] = await db().select({ vozes: nichos.vozes, vozesEm: nichos.vozesEm }).from(nichos).where(eq(nichos.id, marca.nichoId));
  const [temasAntes] = await db().select().from(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));

  const vozes: VozesDoSetor = {
    duvidas: [voz(PERGUNTA, 14), voz("Quanto tempo tem que esperar, mesmo?", 9)],
    objecoes: [voz(RECLAMACAO, 7)],
    pedidos: [],
    videos: 12,
    comentarios: 840,
    plataformas: ["youtube"],
  };
  const temas: TemaDoDia[] = [
    { titulo: "O erro que faz a mancha voltar depois da limpeza", descricao: "d", porQue: "Três contas do seu setor postaram sobre isso nesta semana e todas passaram do normal delas.", evidencias: [], puxaPara: "alcance" },
    { titulo: "O que fazer antes de aplicar o produto", descricao: "d", porQue: "Uma dúvida que aparece toda semana nos comentários das contas do seu setor.", evidencias: [], puxaPara: "engajamento" },
    { titulo: "Quanto custa limpar errado duas vezes", descricao: "d", porQue: "Assunto de custo está subindo no setor desde sexta.", evidencias: [], puxaPara: "conversao" },
  ];
  await db().delete(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));
  await db().insert(temasDia).values({ nichoId: marca.nichoId, data: hoje, temas });
  const chavePergunta = chaveDaVoz("duvida", PERGUNTA);
  const chaveReclamacao = chaveDaVoz("objecao", RECLAMACAO);

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

        // Com as vozes da semana lidas agora.
        await db().update(nichos).set({ vozes, vozesEm: new Date() }).where(eq(nichos.id, marca.nichoId));

        // 1. o bloco depois dos três temas
        await page.goto(`${baseUrl}/criar/temas`);
        const bloco = page.locator("[data-perguntas-do-publico]");
        await bloco.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const foto1 = nomeDe("Temas", "Perguntas");
        await fotografarElemento(page, bloco, foto1);
        gravados.push(foto1);

        // 2. a quinta porta do Criar, com as perguntas
        await page.goto(`${baseUrl}/criar`);
        const porta = page.locator("[data-porta-perguntas='com']");
        await porta.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const foto2 = nomeDe("Criar", "PortaComPerguntas");
        await fotografarElemento(page, porta, foto2);
        gravados.push(foto2);

        // 3. as Referências: a linha fechada e o bloco aberto
        await page.goto(`${baseUrl}/referencias`);
        const linha = page.locator("[data-perguntas-linha]");
        await linha.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const foto3 = nomeDe("Referencias", "LinhaFechada");
        await fotografarElemento(page, linha, foto3);
        gravados.push(foto3);
        await linha.getByRole("button", { name: "Ver as perguntas" }).click();
        const aberto = page.locator("[data-perguntas-do-publico]");
        await aberto.waitFor({ state: "visible" });
        const foto4 = nomeDe("Referencias", "BlocoAberto");
        await fotografarElemento(page, aberto, foto4);
        gravados.push(foto4);

        // 4. o Tema livre com a pergunta presa, e com a reclamação
        for (const [estado, chave] of [
          ["ComPergunta", chavePergunta],
          ["ComReclamacao", chaveReclamacao],
        ] as const) {
          await page.goto(`${baseUrl}/criar/tema-livre?pergunta=${chave}`);
          await page.locator("[data-pergunta-presa]").waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          await limparTela(page);
          await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
          const foto = nomeDe("TemaLivre", estado);
          await page.screenshot({ path: foto, fullPage: true });
          gravados.push(foto);
        }

        // 5. o estado calmo: o setor que fechou a semana sem voz
        await db().update(nichos).set({ vozes: null, vozesEm: null }).where(eq(nichos.id, marca.nichoId));
        await page.goto(`${baseUrl}/criar`);
        const semVoz = page.locator("[data-porta-perguntas='sem']");
        await semVoz.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const foto5 = nomeDe("Criar", "PortaSemPerguntas");
        await fotografarElemento(page, semVoz, foto5);
        gravados.push(foto5);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().update(nichos).set({ vozes: setorAntes?.vozes ?? null, vozesEm: setorAntes?.vozesEm ?? null }).where(eq(nichos.id, marca.nichoId));
    await db().delete(temasDia).where(and(eq(temasDia.nichoId, marca.nichoId), eq(temasDia.data, hoje)));
    if (temasAntes) await db().insert(temasDia).values({ nichoId: marca.nichoId, data: hoje, temas: temasAntes.temas });
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
