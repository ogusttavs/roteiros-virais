/**
 * Capturas da E52 parte 5 (o modo gravação do vídeo longo, passo 26 do Opus): o primeiro capítulo (com o gancho do vídeo), um capítulo do meio, o último (com a chamada final) e o fim com a
 * lista dos capítulos e "Copiar os capítulos", em 390 e 820, claro e escuro; mais o roteiro longo com as marcas de fala ligadas (390 e 1280). Nenhum dado de cliente: a marca é a da limpeza do
 * seed e o roteiro longo é inventado (o script o põe no banco, tira as fotos e apaga o que pôs). O "Já gravei" fica no armazenamento do aparelho, então o script o põe por lá.
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` de desenvolvimento ou descartável, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock` para o simulador escrever as marcas).
 *
 * Uso: `AI_PROVIDER=mock CAPTURAS_URL=http://localhost:3292 npx tsx scripts/capturas-e52-pr5.ts <nome-da-pasta>` (ex.: "pr-e52-5").
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
const PREFIXO = "captura-5-longo";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "820", largura: 820, altura: 1100 },
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

async function main(): Promise<void> {
  const pasta = process.argv[2];
  if (!pasta) throw new Error("uso: npx tsx scripts/capturas-e52-pr5.ts <nome-da-pasta>");
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
        const sufixo = `${tamanho.rotulo}.${modo.rotulo}`;
        const gravados = (indices: number[]) => page.evaluate(([chave, valor]) => window.localStorage.setItem(chave, valor), [`capitulos-gravados:${linha.id}`, JSON.stringify(indices)]);

        // as marcas são escritas na primeira abertura do roteiro (o simulador); abrir o roteiro antes deixa o modo gravação encontrá-las prontas
        await page.goto(`${baseUrl}/roteiros/${linha.id}`);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);

        await gravados([]);
        await page.goto(`${baseUrl}/roteiros/${linha.id}/gravar`);
        await page.locator("[data-capitulo-da-vez]").waitFor();
        await page.waitForLoadState("networkidle");
        await fotografar(page, null, path.join(destino, `Gravacao.Longo.Capitulo1.${sufixo}.png`));

        await gravados([0, 1]);
        await page.reload();
        await page.locator("[data-capitulo-da-vez='3']").waitFor();
        await fotografar(page, null, path.join(destino, `Gravacao.Longo.Capitulo3.${sufixo}.png`));

        await gravados([0, 1, 2]);
        await page.reload();
        await page.locator("[data-capitulo-da-vez='4']").waitFor();
        await fotografar(page, null, path.join(destino, `Gravacao.Longo.Ultimo.${sufixo}.png`));

        await gravados([0, 1, 2, 3]);
        await page.reload();
        await page.locator("[data-gravacao-longa-fim]").waitFor();
        await fotografar(page, null, path.join(destino, `Gravacao.Longo.Fim.${sufixo}.png`));

        await page.goto(`${baseUrl}/roteiros/${linha.id}`);
        await page.locator("[data-capitulo]").first().waitFor();
        const chave = page.getByRole("switch", { name: /Marcas de fala/ });
        if ((await chave.count()) > 0 && (await chave.getAttribute("aria-checked")) !== "true") await chave.click();
        await page.waitForTimeout(1500);
        await fotografar(page, page.locator("[data-capitulo='2']"), path.join(destino, `Roteiro.Longo.Marcas.Capitulo.${sufixo}.png`));
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
