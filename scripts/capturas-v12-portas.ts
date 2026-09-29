/**
 * Capturas do Hoje em duas portas (V12, definição de pronto do
 * `PROXIMO.md`): sem porta escolhida, a porta Reels na primeira vez (a
 * pergunta "Onde você posta mais?"), a porta Reels já respondida, a porta
 * Story, e o Hoje com o bloco "O seu plano de hoje". Três larguras (390,
 * 820, 1280), dois modos. Mesmo padrão de `scripts/capturas-v9b-plano.ts`.
 *
 * A rede principal e o plano de hoje vão direto no banco (mais rápido e
 * determinístico do que passar pelos chips e pela folha "Planejar os
 * próximos dias"), mesmo espírito de `garantirTemasDeHoje` inserindo direto
 * em `temas_dia`. A ordem das capturas importa: "SemPorta" e "ReelsPrimeiraVez"
 * saem antes de gravar a rede principal; "ComPlanoDoDia" sai por último,
 * depois de inserir o plano (as capturas anteriores ficariam com o bloco a
 * mais se ele entrasse antes).
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v12-portas -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes, planoGravacoes, temasDia, videos, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario, salvarRedePrincipal } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "820", largura: 820, altura: 1180 },
  { rotulo: "1280", largura: 1280, altura: 900 },
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

/** O plano de hoje, direto no banco, para a captura "ComPlanoDoDia". */
async function garantirPlanoDeHoje(clienteId: number): Promise<void> {
  await db().delete(planoGravacoes).where(eq(planoGravacoes.clienteId, clienteId));
  await db().insert(planoGravacoes).values({
    clienteId,
    dia: hojeISO(),
    ordem: 1,
    lugar: "feira de fornecedores",
    situacao: "andando entre os estandes, atrás de embalagem nova",
    oQueMostrar: "as prateleiras cheias de produtos e o movimento de gente andando",
    objetivo: "alcance",
    estado: "sugerido",
  });
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
    console.error('uso: npm run capturas:v12-portas -- <nome-da-etapa> (ex.: "pr-v12")');
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
  // Limpa a rede principal e o plano de hoje, para as duas primeiras capturas saírem do estado inicial de verdade.
  await db().update(clientes).set({ redePrincipal: null }).where(eq(clientes.id, cliente.id));
  await db().delete(planoGravacoes).where(eq(planoGravacoes.clienteId, cliente.id));

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function capturar(nomeEstado: string, url: string, esperar: (page: Page) => Promise<unknown>) {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(url);
        await esperar(page);

        const nomeArquivo = `Hoje.${nomeEstado}.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo), fullPage: true });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
        await contexto.close();
      }
    }
  }

  try {
    await capturar("SemPorta", `${baseUrl}/hoje`, (page) => page.getByText("O que você quer gravar agora?").waitFor());

    await capturar("ReelsPrimeiraVez", `${baseUrl}/hoje?porta=reels`, (page) =>
      page.getByText("Onde você posta mais?").waitFor(),
    );

    await salvarRedePrincipal(cliente.id, "instagram");

    await capturar("ReelsRespondida", `${baseUrl}/hoje?porta=reels`, (page) =>
      page.getByText("As referências e os exemplos vêm dessa rede.").waitFor(),
    );

    await capturar("Story", `${baseUrl}/hoje?porta=story`, (page) =>
      page.getByRole("button", { name: "Planejar os próximos dias" }).waitFor(),
    );

    await garantirPlanoDeHoje(cliente.id);

    await capturar("ComPlanoDoDia", `${baseUrl}/hoje`, (page) => page.getByText("O seu plano de hoje").waitFor());
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
