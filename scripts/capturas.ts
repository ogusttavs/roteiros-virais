/**
 * Capturas do painel para revisao visual (etapa 12, ajuste 3 da revisao da
 * parte 1; nomes no padrao do design v2 desde a D2 parte 1, item 9 do
 * `PROXIMO.md`: `Tela.Estado.Largura.Modo`, como
 * `entregaveis/design-v2/entrega/telas/README.md`): as ferramentas de
 * navegador das sessoes de agente nao gravam arquivo, entao um pedido de
 * captura nunca sai de verdade. Este script sobe o Playwright direto, fora
 * da suite de testes, entra com o cliente de exemplo de limpeza e grava um
 * PNG de cada tela pedida, claro e escuro, a 390 (celular), 1024 (tablet) e
 * 1280 (desktop). Usa o cliente de limpeza, nao o de dentistas, porque
 * `scripts/semear.ts` deixa o de dentistas de proposito sem briefing
 * completo, para `briefing.spec.ts` exercitar o fluxo de onboarding
 * inteiro.
 *
 * Revisao do PR #31 (item 11): a captura "depois" do PR mostrava Hoje no
 * estado vazio, porque o seed nao grava `temas_dia` de hoje para o cliente
 * de exemplo, e isso invalidou a conferencia visual contra o design. Agora
 * o script garante uma linha de hoje (tres temas, evidencia apontando para
 * um video real do seed) antes de capturar, e tira Hoje duas vezes: sem
 * roteiro do dia (`Hoje.Normal`) e com (`Hoje.Gerado`).
 *
 * Pre-requisitos, antes de rodar:
 * 1. `DATABASE_URL` do `.env` apontando para `roteiros_dev` (nunca
 *    `roteiros`, o banco de trabalho: `FLUXO.md`, "Um Postgres local,
 *    varias sessoes"; `resetarSchema` ja recusa esse nome).
 * 2. `npm run db:seed` rodado uma vez contra esse banco.
 * 3. `npm run dev` rodando, na mesma porta que `CAPTURAS_URL` aponta
 *    (padrao `http://localhost:3000`).
 *
 * Uso: `npm run capturas -- <nome-da-etapa>` (ex.: `npm run capturas --
 * etapa-12`). Grava em `entregaveis/design/capturas/<nome-da-etapa>/`. O
 * comando no `package.json` ja forca `AI_PROVIDER=mock` (gerar um roteiro
 * de exemplo no seed nao deveria gastar credito real).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { temasDia, videos, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { clienteDoUsuario, salvarTema } from "../src/servicos/clientes";
import { gerarRoteiro, roteiroDeHoje } from "../src/servicos/roteiro";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1024", largura: 1024, altura: 768 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

/** Garante um roteiro de hoje para o cliente de seed, gerando um se faltar. */
async function garantirRoteiro(clienteId: number): Promise<number> {
  const existente = await roteiroDeHoje(clienteId);
  if (existente) return existente.id;

  const roteiro = await gerarRoteiro(clienteId, {
    origem: "livre",
    textoTema: "como organizar o guarda roupa em uma tarde sem gastar muito",
    objetivo: "conversao",
  });
  return roteiro.id;
}

/**
 * Garante os temas de hoje do nicho do cliente, com evidência real
 * (revisão do PR #31, item 11): sem isso, Hoje cai no estado vazio e a
 * captura não mostra o que o design desenha.
 */
async function garantirTemasDeHoje(nichoId: number): Promise<void> {
  const [existente] = await db()
    .select({ data: temasDia.data })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (existente) return;

  const videosDoNicho = await db()
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.nichoId, nichoId))
    .orderBy(desc(videos.foraDaCurva))
    .limit(3);
  const evidenciaPrincipal = videosDoNicho.map((v) => v.id).slice(0, 2);

  const temas: TemaDoDia[] = [
    {
      titulo: "[exemplo] o erro que faz a mancha voltar depois da limpeza",
      descricao: "descrição do tema de exemplo",
      porQue: "está subindo mais rápido que o normal da conta",
      evidencias: evidenciaPrincipal,
      puxaPara: "conversao",
    },
    {
      titulo: "[exemplo] o que fazer antes de aplicar o produto",
      descricao: "descrição do tema de exemplo",
      porQue: "uma dúvida que aparece toda semana nos comentários",
      evidencias: videosDoNicho[2] ? [videosDoNicho[2].id] : [],
      puxaPara: "engajamento",
    },
    {
      titulo: "[exemplo] quanto custa limpar errado duas vezes",
      descricao: "descrição do tema de exemplo",
      porQue: "assunto de custo está subindo no setor",
      evidencias: [],
      puxaPara: "alcance",
    },
  ];
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas -- <nome-da-etapa> (ex.: "etapa-12")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const cliente = await clienteDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(
      `cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra o banco desta sessao (roteiros_dev, nunca roteiros).`,
    );
  }
  if (!cliente.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }

  await garantirTemasDeHoje(cliente.nichoId);

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function paraCadaTela(
    acao: (page: Page, tamanho: (typeof TAMANHOS)[number], modo: (typeof MODOS)[number]) => Promise<void>,
  ): Promise<void> {
    for (const modo of MODOS) {
      await salvarTema(cliente!.id, modo.colorScheme === "dark" ? "escuro" : "claro");
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await acao(page, tamanho, modo);
        await contexto.close();
      }
    }
  }

  async function capturar(page: Page, caminho: string, tela: string, estado: string, rotulo: string, modo: string): Promise<void> {
    await page.goto(`${baseUrl}${caminho}`);
    await page.waitForLoadState("networkidle");
    const nomeArquivo = `${tela}.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  try {
    // Passo 1: Hoje.Normal, sem roteiro do dia, em todas as larguras e nos dois modos.
    await paraCadaTela(async (page, tamanho, modo) => {
      await capturar(page, "/hoje", "Hoje", "Normal", tamanho.rotulo, modo.rotulo);
    });

    // Passo 2: o roteiro do dia passa a existir; o resto das telas, com Hoje.Gerado.
    const roteiroId = await garantirRoteiro(cliente.id);
    await paraCadaTela(async (page, tamanho, modo) => {
      await capturar(page, "/hoje", "Hoje", "Gerado", tamanho.rotulo, modo.rotulo);
      await capturar(page, `/roteiros/${roteiroId}`, "Roteiro", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, `/roteiros/${roteiroId}/gravar`, "Gravacao", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/referencias", "Referencias", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/historico", "Historico", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/briefing", "Briefing", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/conta", "Conta", "Normal", tamanho.rotulo, modo.rotulo);
    });
  } finally {
    await browser.close();
    await salvarTema(cliente.id, "sistema");
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
