/**
 * Capturas da E50 parte 2, PR 4 (o "Por quê" de cada bloco, passo 24 do Opus): o Reels falado com os porquês fechados, um aberto e todos abertos ("Ver os porquês"), e o roteiro longo com o
 * gancho, um capítulo e a chamada abertos; em 390 e 1280, claro e escuro. Nenhum dado de cliente: a seed e os roteiros são inventados (o script os põe no banco, tira as fotos e apaga o que pôs).
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` de desenvolvimento ou descartável, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`).
 *
 * Uso: `AI_PROVIDER=mock CAPTURAS_URL=http://localhost:3292 npx tsx scripts/capturas-e50-pr4.ts <nome-da-pasta>` (ex.: "pr-e50-4").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros, type CapituloDoRoteiro, type ConteudoRoteiro } from "../src/db/schema";
import { camposCorridosDosCapitulos, somaDosCapitulos } from "../src/lib/capitulos-do-roteiro";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const PREFIXO = "captura-50-4";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const CAPITULOS: CapituloDoRoteiro[] = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 50, tom: "direto", pontos: ["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"], naImagem: "o sofá com a mancha, perto", ganchoParaOProximo: "Fica até o fim que eu te mostro os quatro erros.", comoEditar: "Na tela: a mancha voltou?" },
  { nome: "Erro 1: esfregar antes do tempo", inicioS: 50, duracaoS: 110, tom: "calmo", pontos: ["Aplique e mostre o relógio", "Explique que esfregar antes espalha a sujeira pelo tecido"], naImagem: "o relógio ao lado do sofá", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete com o melhor produto.", comoEditar: "Acelere a espera." },
  { nome: "Erro 2: produto demais", inicioS: 160, duracaoS: 110, tom: "calmo", pontos: ["Mostre a quantidade certa na tampa", "Compare com a que as pessoas costumam usar", "Conte o que sobra no tecido quando vai produto demais"], naImagem: "duas tampas lado a lado", ganchoParaOProximo: "O terceiro erro acontece depois que a mancha já saiu.", comoEditar: "Duas tampas na mesma imagem." },
  { nome: "O que fazer amanhã", inicioS: 270, duracaoS: 60, tom: "firme", pontos: ["Resuma os erros em uma frase cada", "Peça a mensagem com a foto da mancha"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Termine olhando para a câmera." },
];

function conteudoLongo(): ConteudoRoteiro {
  const corridos = camposCorridosDosCapitulos(CAPITULOS);
  return {
    titulo: "Os quatro erros que fazem a mancha do sofá voltar, do começo ao fim",
    duracaoS: somaDosCapitulos(CAPITULOS),
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto. Fica até o fim que eu te mostro os quatro erros.",
    corpo: corridos.corpo,
    fechamento: corridos.fechamento,
    chamadaFinal: "Me manda a foto da sua mancha que eu digo o que usar.",
    cartoes: null,
    porQueAssim: [],
    cenas: corridos.cenas,
    ondeGravar: "na sala de casa",
    edicao: { textoNaTela: [{ quando: "no começo de cada capítulo", onde: "no alto", oQue: "o nome do capítulo" }], ritmoDeCorte: "Mais calmo que o vídeo curto.", recursos: [], audio: "Sem música por baixo da fala.", referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    capitulos: CAPITULOS,
    miniatura: "O sofá com a mancha e o texto: volta sempre?",
    porQueDosBlocos: [
      { bloco: "gancho", regras: ["R-COPY-05"], para: "fiquem" },
      { bloco: "capitulo:1", regras: ["R-COPY-13", "R-COPY-12"], para: "guardem" },
      { bloco: "chamada", regras: ["R-COPY-25"], para: "chamem" },
    ],
  };
}

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
}

async function fotografar(page: Page, alvo: Locator | null, arquivo: string): Promise<void> {
  await limparTela(page);
  if (alvo) await alvo.screenshot({ path: arquivo });
  else await page.screenshot({ path: arquivo });
}

function conteudoReels(): ConteudoRoteiro {
  return {
    titulo: "A mancha que volta",
    duracaoS: 40,
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto. É a ordem.",
    corpo: "Aplique, espere dez minutos e só então esfregue. Diga o tempo em voz alta. O sofá da dona Neusa levou 12 minutos e ficou limpo.",
    fechamento: "A ordem certa muda tudo.",
    chamadaFinal: "Me manda a foto da sua mancha no WhatsApp.",
    cartoes: null,
    porQueAssim: [],
    cenas: [
      { momento: "0 segundos", oQueFazer: "mostre o sofá com a mancha de volta" },
      { momento: "12 segundos", oQueFazer: "aplique o produto e mostre o relógio" },
    ],
    ondeGravar: "na sala de casa",
    edicao: { textoNaTela: [{ quando: "0 a 2 s", onde: "no topo", oQue: "a mancha voltou?" }, { quando: "12 s", onde: "embaixo", oQue: "a ordem certa" }], ritmoDeCorte: "Corte seco a cada frase.", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    porQueDosBlocos: [
      { bloco: "gancho", regras: ["R-COPY-05"], para: "fiquem" },
      { bloco: "corpo", regras: ["R-COPY-13", "R-COPY-12"], para: "confiem" },
      { bloco: "chamada", regras: ["R-COPY-25"], para: "chamem" },
      { bloco: "tela:0", regras: ["R-COPY-12"] },
      { bloco: "tela:1", regras: ["R-COPY-13"] },
    ],
  };
}

async function main(): Promise<void> {
  const pasta = process.argv[2];
  if (!pasta) throw new Error("uso: npx tsx scripts/capturas-e50-pr4.ts <nome-da-pasta>");
  const destino = path.join(process.cwd(), "..", "entregaveis", "design", "capturas", pasta);
  await mkdir(destino, { recursive: true });
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca) throw new Error("rode npm run db:seed antes");
  await db().delete(roteiros).where(and(eq(roteiros.clienteId, marca.id), like(roteiros.tema, `${PREFIXO}%`)));
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId: marca.id, data: hojeISO(), tema: PREFIXO, origem: "livre", objetivo: "alcance", duracaoDoVideo: "longo", conteudo: conteudoLongo() })
    .returning({ id: roteiros.id });
  const [reels] = await db()
    .insert(roteiros)
    .values({ clienteId: marca.id, data: hojeISO(), tema: `${PREFIXO}-reels`, origem: "livre", objetivo: "alcance", conteudo: conteudoReels() })
    .returning({ id: roteiros.id });
  const idLongo = linha.id;
  const idReels = reels.id;

  const navegador = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await navegador.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        await page.goto(`${baseUrl}/entrar`);
        await page.getByLabel("E-mail").fill(EMAIL);
        await page.getByLabel("Senha").fill(SENHA_SEED);
        await page.getByRole("button", { name: "entrar", exact: true }).click();
        await page.waitForURL(/\/(hoje|comecar)/, { timeout: 90_000 });
        await page.waitForLoadState("networkidle");
        const sufixo = `${tamanho.rotulo}.${modo.rotulo}`;

        await page.goto(`${baseUrl}/roteiros/${idReels}`);
        await page.getByRole("button", { name: "Por quê: Os 3 primeiros segundos" }).first().waitFor().catch(() => undefined);
        await page.waitForLoadState("networkidle");
        await fotografar(page, null, path.join(destino, `Roteiro.Fechado.${sufixo}.png`));

        await page.getByRole("button", { name: /^Por quê: / }).first().click();
        await fotografar(page, null, path.join(destino, `Roteiro.UmAberto.${sufixo}.png`));

        await page.getByRole("button", { name: "Ver os porquês" }).click();
        await fotografar(page, null, path.join(destino, `Roteiro.TodosAbertos.${sufixo}.png`));

        await page.goto(`${baseUrl}/roteiros/${idLongo}`);
        await page.locator("[data-capitulo]").first().waitFor();
        await page.getByRole("button", { name: "Ver os porquês" }).click();
        await fotografar(page, page.locator("[data-capitulo='2']"), path.join(destino, `Longo.Capitulo.${sufixo}.png`));
        await fotografar(page, page.locator("[data-capitulo='1']"), path.join(destino, `Longo.Gancho.${sufixo}.png`));
        await contexto.close();
      }
    }
  } finally {
    await navegador.close();
    await db().delete(roteiros).where(eq(roteiros.id, linha.id));
    await db().delete(roteiros).where(eq(roteiros.id, reels.id));
    await getPool().end();
  }
}

void main();
