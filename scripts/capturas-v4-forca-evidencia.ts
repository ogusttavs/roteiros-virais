/**
 * Capturas do cartão "de onde veio" com as três forças da evidência (V4,
 * roteiro sem vício, definição de pronto): `Roteiro.ForcaForte`,
 * `Roteiro.ForcaMedia`, `Roteiro.ForcaFraca`, nas larguras do design (390,
 * 1024, 1280) e nos dois modos. Script próprio, fora da suíte de testes, no
 * mesmo padrão de `scripts/capturas-v3-marcas.ts`: monta um roteiro por
 * força direto no banco (a força já vem calculada e gravada,
 * `forcaDaEvidencia`; aqui só se grava o resultado pronto, para a captura
 * não depender de replicar os limiares) e usa o Playwright para navegar e
 * gravar PNG.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v4-forca-evidencia -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { contas, roteiros, videos, type ConteudoRoteiro, type ForcaEvidencia } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

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

const FORCAS: { forca: ForcaEvidencia; multiplo: string; conta: string; texto: string }[] = [
  {
    forca: "forte",
    multiplo: "5.0",
    conta: "@limpeza_forte_captura",
    texto: "mostra o produto agindo direto na mancha, sem cortar",
  },
  {
    forca: "media",
    multiplo: "2.1",
    conta: "@limpeza_media_captura",
    texto: "mostra o antes e o depois lado a lado",
  },
  {
    forca: "fraca",
    multiplo: "1.6",
    conta: "@limpeza_fraca_captura",
    texto: "so um video ainda, mas o gancho e direto",
  },
];

/** Um vídeo e um roteiro por força, direto no banco (a marca de seed já existe, `npm run db:seed`). */
async function garantirFixture(): Promise<{ roteiroIdPorForca: Record<ForcaEvidencia, number> }> {
  const marcas = await marcasDoUsuario(USUARIO_SEED);
  const marca = marcas[0];
  if (!marca) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" primeiro.`);
  }
  if (!marca.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }

  const roteiroIdPorForca = {} as Record<ForcaEvidencia, number>;

  for (const { forca, multiplo, conta: handleConta, texto } of FORCAS) {
    const [conta] =
      (await db().select().from(contas).where(eq(contas.handle, handleConta))).length > 0
        ? await db().select().from(contas).where(eq(contas.handle, handleConta))
        : await db()
            .insert(contas)
            .values({
              plataforma: "youtube",
              handle: handleConta,
              nome: handleConta,
              nichoId: marca.nichoId,
              medianaViews: "1000",
            })
            .returning();

    const idExterno = `captura-v4-${forca}`;
    const existente = await db().select().from(videos).where(eq(videos.idExterno, idExterno));
    const [video] =
      existente.length > 0
        ? existente
        : await db()
            .insert(videos)
            .values({
              plataforma: "youtube",
              idExterno,
              url: `https://exemplo.invalido/${idExterno}`,
              nichoId: marca.nichoId,
              contaId: conta.id,
              titulo: "o produto que tira qualquer mancha do estofado",
              views: 5200,
              foraDaCurva: multiplo,
              publicadoEm: new Date(),
              analise: {
                assunto: "mancha em estofado",
                gancho: "esse produto tira qualquer mancha do estofado",
                estrutura: texto,
                fechamento: "resumo do que foi mostrado",
                chamadaFinal: "comenta se voce ja passou por isso",
                formato: "fala_para_camera",
                porQueFuncionou: texto,
              } as never,
            })
            .returning();

    const conteudo: ConteudoRoteiro = {
      titulo: `o erro que faz a mancha voltar (${forca})`,
      duracaoS: 40,
      gancho: "se a mancha volta dois dias depois, o problema nao e o produto",
      corpo: "explique a ordem certa enquanto faz. aplicar, esperar o tempo, e so entao esfregar.",
      fechamento: "mostre a peca limpa",
      chamadaFinal: "manda uma mensagem que eu te digo qual produto usar",
      cenas: [{ momento: "abertura", oQueFazer: "mostrar a mancha" }],
      ondeGravar: "na sala, perto do sofa",
      edicao: {
        textoNaTela: [],
        ritmoDeCorte: "moderado",
        recursos: [],
        audio: null,
        referencia: { videoId: video.id, segundo: 4, oQueOlhar: "o antes e depois" },
      },
      evidencias: [video.id],
      semEvidencia: false,
      forcaEvidencia: forca,
    };

    const existenteRoteiro = await db()
      .select()
      .from(roteiros)
      .where(eq(roteiros.tema, conteudo.titulo));
    const [roteiro] =
      existenteRoteiro.length > 0
        ? existenteRoteiro
        : await db()
            .insert(roteiros)
            .values({
              clienteId: marca.id,
              data: "2026-01-01",
              tema: conteudo.titulo,
              origem: "livre",
              objetivo: "conversao",
              conteudo,
              referenciaVideoId: video.id,
              tipoAbertura: "cena",
            })
            .returning();

    roteiroIdPorForca[forca] = roteiro.id;
  }

  return { roteiroIdPorForca };
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v4-forca-evidencia -- <nome-da-etapa> (ex.: "pr-48")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const { roteiroIdPorForca } = await garantirFixture();

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function capturar(page: Page, estado: string, rotulo: string, modo: string): Promise<void> {
    const nomeArquivo = `Roteiro.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  const ESTADO_POR_FORCA: Record<ForcaEvidencia, string> = {
    forte: "ForcaForte",
    media: "ForcaMedia",
    fraca: "ForcaFraca",
  };

  try {
    for (const { forca } of FORCAS) {
      const roteiroId = roteiroIdPorForca[forca];
      for (const modo of MODOS) {
        for (const tamanho of TAMANHOS) {
          const contexto = await browser.newContext({
            viewport: { width: tamanho.largura, height: tamanho.altura },
            colorScheme: modo.colorScheme,
          });
          const page = await contexto.newPage();
          await entrar(page, baseUrl);
          await page.goto(`${baseUrl}/roteiros/${roteiroId}`);
          await page.waitForLoadState("networkidle");
          await capturar(page, ESTADO_POR_FORCA[forca], tamanho.rotulo, modo.rotulo);
          await contexto.close();
        }
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
