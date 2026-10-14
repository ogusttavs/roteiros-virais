/**
 * Capturas da E52 parte 4b (o roteiro do vídeo longo por capítulos, passo 25 do Opus): a tela do roteiro inteira e o cartão de um capítulo (em leitura e em edição), em 390 e 1280, claro e
 * escuro. Nenhum dado de cliente: a marca é a da limpeza do seed e o roteiro longo é inventado (o script o põe no banco, tira as fotos e apaga o que pôs).
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para um banco de desenvolvimento ou descartável, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta
 * de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr4b.ts <nome-da-pasta>` (ex.: "pr-e52-4b").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros, type CapituloDoRoteiro, type ConteudoRoteiro } from "../src/db/schema";
import { somaDosCapitulos } from "../src/lib/capitulos-do-roteiro";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const PREFIXO = "captura-4b-longo";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const CAPITULOS: CapituloDoRoteiro[] = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 50, tom: "direto", pontos: ["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"], naImagem: "o sofá com a mancha, perto", ganchoParaOProximo: "Fica até o fim que eu te mostro os quatro erros", comoEditar: "Na tela: a mancha voltou? Corte a cada 5 segundos." },
  { nome: "Erro 1: esfregar antes do tempo", inicioS: 50, duracaoS: 110, tom: "calmo", pontos: ["Aplique e mostre o relógio", "Explique que esfregar antes espalha a sujeira pelo tecido"], naImagem: "o relógio ao lado do sofá", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete com o melhor produto", comoEditar: "Acelere a espera, sem cortar a aplicação." },
  { nome: "Erro 2: produto demais", inicioS: 160, duracaoS: 110, tom: "calmo", pontos: ["Mostre a quantidade certa na tampa", "Compare com a que as pessoas costumam usar"], naImagem: "duas tampas lado a lado", ganchoParaOProximo: "O terceiro erro acontece depois que a mancha já saiu", comoEditar: "Duas tampas na mesma imagem. Nenhum efeito." },
  { nome: "O que fazer amanhã", inicioS: 270, duracaoS: 60, tom: "firme", pontos: ["Resuma os erros em uma frase cada", "Peça a mensagem com a foto da mancha"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Os erros na tela, um por vez. Termine olhando para a câmera." },
];

function conteudoLongo(): ConteudoRoteiro {
  return {
    titulo: "Os quatro erros que fazem a mancha do sofá voltar, do começo ao fim",
    duracaoS: somaDosCapitulos(CAPITULOS),
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto. Fica até o fim que eu te mostro os quatro erros.",
    corpo: CAPITULOS.map((c, i) => `${i + 1}. ${c.nome}: ${c.pontos.join("; ")}`).join("\n"),
    fechamento: CAPITULOS[CAPITULOS.length - 1].pontos.join("; "),
    chamadaFinal: "Me manda a foto da sua mancha que eu digo o que usar.",
    cartoes: null,
    porQueAssim: [],
    cenas: CAPITULOS.map((c) => ({ momento: `${c.inicioS} segundos`, oQueFazer: c.naImagem })),
    ondeGravar: "na sala de casa",
    edicao: {
      textoNaTela: [{ quando: "no começo de cada capítulo", onde: "no alto", oQue: "o nome do capítulo" }],
      ritmoDeCorte: "Mais calmo que o vídeo curto: corte a cada 5 a 8 segundos, e deixe correr quando você está fazendo.",
      recursos: [],
      audio: "Sem música por baixo da fala.",
      referencia: null,
    },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    capitulos: CAPITULOS,
    miniatura: "O sofá com a mancha e o texto: volta sempre?",
  };
}

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
}

async function fotografar(page: Page, alvo: Locator | null, arquivo: string): Promise<void> {
  await limparTela(page);
  if (alvo) await alvo.screenshot({ path: arquivo });
  else await page.screenshot({ path: arquivo, fullPage: true });
}

async function main(): Promise<void> {
  const pasta = process.argv[2];
  if (!pasta) throw new Error("uso: npx tsx scripts/capturas-e52-pr4b.ts <nome-da-pasta>");
  const destino = path.join(process.cwd(), "..", "entregaveis", "design", "capturas", pasta);
  await mkdir(destino, { recursive: true });
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";

  const [marca] = await marcasDoUsuario(USUARIO).then((m) => m.slice(0, 1));
  if (!marca) throw new Error("rode npm run db:seed antes");
  await db().delete(roteiros).where(and(eq(roteiros.clienteId, marca.id), like(roteiros.tema, `${PREFIXO}%`)));
  const conteudo = conteudoLongo();
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId: marca.id, data: hojeISO(), tema: `${PREFIXO}`, origem: "livre", objetivo: "alcance", duracaoDoVideo: "longo", conteudo })
    .returning({ id: roteiros.id });

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
        await page.waitForLoadState("networkidle");
        await page.goto(`${baseUrl}/roteiros/${linha.id}`);
        await page.locator("[data-capitulo]").first().waitFor();
        await page.waitForLoadState("networkidle");
        const nome = `Roteiro.Longo.${tamanho.rotulo}.${modo.rotulo}`;
        await fotografar(page, null, path.join(destino, `${nome}.png`));
        await fotografar(page, page.locator("[data-capitulo='2']"), path.join(destino, `Roteiro.Longo.Capitulo.${tamanho.rotulo}.${modo.rotulo}.png`));
        await page.getByRole("button", { name: "Editar o capítulo Erro 1: esfregar antes do tempo" }).click();
        await fotografar(page, page.locator("[data-capitulo='2']"), path.join(destino, `Roteiro.Longo.CapituloEditando.${tamanho.rotulo}.${modo.rotulo}.png`));
        await contexto.close();
      }
    }
  } finally {
    await navegador.close();
    await db().delete(roteiros).where(eq(roteiros.id, linha.id));
    await getPool().end();
  }
}

void main();
