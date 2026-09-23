/**
 * Capturas do plano colado a partir da agenda (V9b, definição de pronto do
 * `PROXIMO.md`): o bloco "O seu plano de hoje" (em `/hoje`, com itens já
 * montados) e a folha "Colar a agenda" (vazia, o ponto de entrada), nas três
 * larguras do design (390, 820, 1280) e nos dois modos. Mesmo padrão de
 * `scripts/capturas-v9a-momento.ts`.
 *
 * O bloco só aparece com um plano de hoje já existindo: em vez de passar
 * pela folha (que depende do `AI_PROVIDER=mock`), este script insere direto
 * em `plano_gravacoes`, mais rápido e determinístico (mesmo espírito de
 * `garantirTemasDeHoje`, que insere direto em `temas_dia`).
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v9b-plano -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { temasDia, planoGravacoes, videos, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "820", largura: 820, altura: 1180 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

/** Mesmo raciocínio de `garantirTemasDeHoje` em `scripts/capturas.ts`: sem tema de hoje, `/hoje` cai no estado vazio. */
async function garantirTemasDeHoje(nichoId: number): Promise<void> {
  const [existente] = await db()
    .select({ data: temasDia.data })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (existente) return;

  const videosDoNicho = await db().select({ id: videos.id }).from(videos).where(eq(videos.nichoId, nichoId)).limit(2);
  const temas: TemaDoDia[] = [
    {
      titulo: "[exemplo] o erro que faz a mancha voltar depois da limpeza",
      descricao: "descrição do tema de exemplo",
      porQue: "está subindo mais rápido que o normal da conta",
      evidencias: videosDoNicho.map((v) => v.id),
      puxaPara: "conversao",
    },
    {
      titulo: "[exemplo] o que fazer antes de aplicar o produto",
      descricao: "descrição do tema de exemplo",
      porQue: "uma dúvida que aparece toda semana nos comentários",
      evidencias: [],
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

/** O plano de hoje, direto no banco (mais rápido e determinístico do que passar pela folha). */
async function garantirPlanoDeHoje(clienteId: number): Promise<void> {
  await db().delete(planoGravacoes).where(eq(planoGravacoes.clienteId, clienteId));
  await db()
    .insert(planoGravacoes)
    .values([
      {
        clienteId,
        dia: hojeISO(),
        ordem: 1,
        lugar: "feira de fornecedores",
        situacao: "andando entre os estandes, atrás de embalagem nova",
        oQueMostrar: "as prateleiras cheias de produtos e o movimento de gente andando",
        objetivo: "alcance",
        estado: "sugerido",
      },
      {
        clienteId,
        dia: hojeISO(),
        ordem: 2,
        lugar: "fábrica do fornecedor",
        situacao: "vendo de perto como fazem o frasco novo",
        oQueMostrar: "a linha de produção rodando e os frascos saindo prontos",
        objetivo: "engajamento",
        estado: "sugerido",
      },
    ]);
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v9b-plano -- <nome-da-etapa> (ex.: "pr-56")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(
      `cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra o banco desta sessao (roteiros_dev, nunca roteiros).`,
    );
  }
  if (!cliente.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }

  await garantirTemasDeHoje(cliente.nichoId);
  await garantirPlanoDeHoje(cliente.id);

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  try {
    // O bloco "O seu plano de hoje", em /hoje, com os dois itens montados acima.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje`);
        await page.getByText("O seu plano de hoje").waitFor({ state: "visible" });

        const nomeArquivo = `PlanoHoje.Bloco.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo), fullPage: true });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
        await contexto.close();
      }
    }

    // A folha "Colar a agenda", vazia (o ponto de entrada do plano).
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje`);
        await page.getByRole("button", { name: "Colar a agenda" }).click();
        await page.getByRole("dialog", { name: "Colar a agenda" }).waitFor({ state: "visible" });

        /**
         * Sem `fullPage` aqui, diferente do bloco acima: a folha é um
         * painel fixo por cima da tela (`Folha.tsx`), e com o plano já
         * colado o Hoje por trás ficou bem mais alto que o das outras
         * capturas de folha (V9a); `fullPage` puxava o documento inteiro e
         * a folha saía pequena, longe do topo da captura.
         */
        const nomeArquivo = `PlanoHoje.FolhaColarAgenda.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
