/**
 * Capturas do roteiro em Story e do modo gravação (V9c, definição de pronto
 * do `PROXIMO.md`): cartões numerados com "Por que assim", em 390, 820 e
 * 1280, claro e escuro. Mesmo padrão de `scripts/capturas-sem-limite-diario.ts`:
 * insere direto no banco (mais rápido e determinístico do que gerar pela
 * tela).
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v9c-story -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros, temasDia, videos, type ConteudoRoteiro, type TemaDoDia } from "../src/db/schema";
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

function conteudoStoryExemplo(titulo: string): ConteudoRoteiro {
  return {
    titulo,
    duracaoS: 30,
    gancho: "",
    corpo: "",
    fechamento: "",
    chamadaFinal: "",
    cartoes: [
      {
        oQueFalar: "hoje eu vou te mostrar o erro que faz a mancha de vinho espalhar em vez de sair",
        oQueMostrar: "o sofá com a mancha, luz da janela batendo no tecido",
        textoNaTela: "o erro que faz a mancha espalhar",
        figurinha: "nenhuma",
      },
      {
        oQueFalar: "voce ja tentou esfregar em circulo e viu a mancha abrir ainda mais",
        oQueMostrar: "o pano branco com a mancha aberta no tecido",
        textoNaTela: "e voce, ja passou por isso",
        figurinha: "perguntas",
      },
      {
        oQueFalar: "manda a sua duvida aqui na caixinha que eu te respondo com o passo a passo certo",
        oQueMostrar: "o kit tira-mancha em cima da bancada, olhando para a camera",
        textoNaTela: "manda sua duvida aqui",
        figurinha: "nenhuma",
      },
    ],
    porQueAssim: [
      { regra: "R-IG-STORY-02", motivo: "o primeiro cartão já mostra a cena, sem se apresentar do zero" },
      { regra: "R-IG-STORY-04", motivo: "a caixinha de perguntas pede interação de quem já compra o produto" },
      { regra: "R-IG-STORY-07", motivo: "o último cartão fecha pedindo para responder na caixinha, não para seguir" },
    ],
    cenas: [{ momento: "abertura", oQueFazer: "mostrar o sofá com a mancha de verdade" }],
    ondeGravar: "na sala, de frente para o sofá, com a luz da janela",
    edicao: {
      textoNaTela: [],
      ritmoDeCorte: "um cartão por vez",
      recursos: [],
      audio: null,
      referencia: null,
    },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
  };
}

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

/** Um roteiro de hoje em Story, direto no banco, para a tela do roteiro e o modo gravação. */
async function garantirRoteiroStoryDeHoje(clienteId: number): Promise<number> {
  const titulo = "o erro que faz a mancha de vinho espalhar em vez de sair";
  await db().delete(roteiros).where(and(eq(roteiros.clienteId, clienteId), eq(roteiros.data, hojeISO())));
  const [linha] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: hojeISO(),
      tema: titulo,
      origem: "sugerido",
      objetivo: "conversao",
      formato: "story",
      conteudo: conteudoStoryExemplo(titulo),
    })
    .returning();
  return linha.id;
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
    console.error('uso: npm run capturas:v9c-story -- <nome-da-etapa> (ex.: "pr-58")');
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
  const roteiroId = await garantirRoteiroStoryDeHoje(cliente.id);

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);

        await page.goto(`${baseUrl}/roteiros/${roteiroId}`);
        await page.getByText("Cartão 1").first().waitFor({ state: "visible" });
        const nomeRoteiro = `V9cStory.Roteiro.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeRoteiro), fullPage: true });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeRoteiro)));

        await page.goto(`${baseUrl}/roteiros/${roteiroId}/gravar`);
        await page.getByText("Cartão 1").first().waitFor({ state: "visible" });
        const nomeGravacao = `V9cStory.Gravacao.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeGravacao), fullPage: true });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeGravacao)));

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
