/**
 * Capturas do PR da E26 que leva o roteiro para fora do painel (PDF, imagem 9:16, "Guardar" e o menu da agenda), em 390 e 1280, claro e escuro: o menu "Mais opções" do roteiro com os três itens, o
 * toast "PDF do roteiro pronto" com "Abrir", o toast "A imagem do roteiro está pronta" com "Guardar" (o aparelho que só compartilha logo depois de um toque), o menu da agenda do Hoje com "Baixar em
 * PDF"; e, sempre claros (papel e galeria não têm tema), a folha A4 do PDF e as imagens 9:16 (a curta, uma só, e a comprida, em dois quadros). Nenhum dado de cliente: a marca é a da limpeza do seed.
 * O script põe os roteiros e o vídeo de exemplo e devolve tudo como estava.
 *
 * Pré-requisitos: um servidor de PRODUÇÃO (`npm run build` e `npm run start`, com `MODO_E2E=1`, como o `playwright.config.ts` sobe) em `CAPTURAS_URL`, no banco `roteiros_dev` (nunca `roteiros`) com
 * `npm run db:seed`, e `BETTER_AUTH_SECRET` igual nos dois lados (o servidor e este script): a página de impressão abre com o token assinado por ele. As imagens do servidor de desenvolvimento saem
 * com o indicador do Next no canto.
 *
 * Uso: `BETTER_AUTH_SECRET=... CAPTURAS_URL=http://localhost:3247 npx tsx scripts/capturas-e26-exportar.ts <nome-da-pasta>` (ex.: "pr-e26-exportar").
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros, videos } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { criarTokenImpressao } from "../src/lib/tokenImpressao";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 1500 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const FALA = "Mostre a peça com a mancha de volta e conte, com as suas palavras, o que você fez da primeira vez, sem cortar a gravação e sem esconder o erro, porque é aí que a pessoa se reconhece.";

const BASE_DO_CONTEUDO = {
  titulo: "O erro que faz a mancha voltar depois da limpeza",
  duracaoS: 40,
  gancho: "Se a mancha volta dois dias depois, o problema não é o produto. É a ordem.",
  corpo: "Mostre a peça com a mancha de volta. Fale o que você fez da primeira vez, sem cortar.\nExplique a ordem certa enquanto faz: aplicar, esperar o tempo, e só então esfregar. Diga o tempo em voz alta, porque é isso que a pessoa vai lembrar.",
  fechamento: "Mostre a peça limpa.",
  chamadaFinal: "Se você tem uma mancha que sempre volta, me manda uma mensagem que eu te digo qual produto usar.",
  cartoes: null,
  porQueAssim: [],
  cenas: [{ momento: "0 a 3 s", oQueFazer: "a peça com a mancha de volta, em primeiro plano" }],
  ondeGravar: "na área de serviço",
  edicao: {
    textoNaTela: [
      { quando: "0 a 2 s", onde: "no topo", oQue: "a mancha voltou?" },
      { quando: "12 s", onde: "no centro", oQue: "a ordem certa" },
    ],
    ritmoDeCorte: "Um corte a cada 4 ou 5 segundos. No trecho da aplicação, deixe correr sem cortar.",
    recursos: ["Nenhum efeito. Aproxime a câmera na hora de mostrar a mancha."],
    audio: "Sem áudio de fundo. Sua voz limpa funciona melhor para explicar passo a passo.",
    referencia: null as { videoId: number | null; segundo: number | null; oQueOlhar: string } | null,
  },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
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
    console.error('uso: BETTER_AUTH_SECRET=... CAPTURAS_URL=... npx tsx scripts/capturas-e26-exportar.ts <nome-da-pasta> (ex.: "pr-e26-exportar")');
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3247";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);

  const [video] = await db()
    .insert(videos)
    .values({ plataforma: "instagram", idExterno: `capturas-e26-${Date.now()}`, url: "https://www.instagram.com/reel/exemplo/", nichoId: marca.nichoId, titulo: "mancha", foraDaCurva: "4.1", publicadoEm: new Date(), analise: { porQueFuncionou: "Mostrar o problema antes de explicar." } as never })
    .returning();
  const comum = { clienteId: marca.id, data: hojeISO(), origem: "livre" as const, objetivo: "conversao" as const, formato: "reels" as const, status: "gerado" as const, objetivoDoVideo: "mostrar que o problema é a ordem, não o produto, e chamar para a mensagem" };
  const [curto] = await db()
    .insert(roteiros)
    .values({ ...comum, tema: "capturas curto", referenciaVideoId: video.id, conteudo: { ...BASE_DO_CONTEUDO, edicao: { ...BASE_DO_CONTEUDO.edicao, referencia: { videoId: video.id, segundo: 4, oQueOlhar: "o antes" } } } })
    .returning({ id: roteiros.id });
  const [longo] = await db()
    .insert(roteiros)
    .values({ ...comum, tema: "capturas longo", conteudo: { ...BASE_DO_CONTEUDO, duracaoS: 90, corpo: [FALA, FALA, FALA, FALA, FALA, FALA].join("\n"), titulo: "Um roteiro comprido, para a imagem partir em dois quadros" } })
    .returning({ id: roteiros.id });
  const ids = [curto.id, longo.id];

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    // A folha A4 e as imagens 9:16: sempre claras, uma vez só.
    {
      const contexto = await browser.newContext({ viewport: { width: 794, height: 1123 }, colorScheme: "light" });
      const page = await contexto.newPage();
      page.setDefaultTimeout(120_000);
      await entrar(page, baseUrl);
      const token = criarTokenImpressao(curto.id, marca.id);
      await page.emulateMedia({ media: "print", colorScheme: "light" });
      await page.goto(`${baseUrl}/roteiros/${curto.id}/imprimir?token=${encodeURIComponent(token)}&formato=a4`);
      await page.waitForLoadState("networkidle");
      await esconderPortal(page);
      // As margens do PDF vêm do `page.pdf()`, não da página: aqui entram como espaço em volta, para a captura se parecer com a folha.
      await page.addStyleTag({ content: "body { padding: 14mm 16mm 18mm; box-sizing: border-box; min-height: 100vh; }" });
      const a4 = path.join(pastaDestino, "RoteiroPDF.A4.794.Claro.png");
      await page.screenshot({ path: a4, fullPage: true });
      gravados.push(a4);

      for (const [nome, id] of [["Curto", curto.id], ["Longo", longo.id]] as const) {
        const resposta = await contexto.request.get(`${baseUrl}/api/roteiros/${id}/imagem`, { timeout: 120_000 });
        if (!resposta.ok()) throw new Error(`imagem de ${nome}: ${resposta.status()} ${await resposta.text()}`);
        const corpo = (await resposta.json()) as { imagens: string[] };
        for (const [indice, base64] of corpo.imagens.entries()) {
          const arquivo = path.join(pastaDestino, `RoteiroImagem.${nome}${corpo.imagens.length > 1 ? indice + 1 : ""}.360.Claro.png`);
          await writeFile(arquivo, Buffer.from(base64, "base64"));
          gravados.push(arquivo);
        }
      }
      await contexto.close();
    }

    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme, acceptDownloads: true });
        // O aparelho de toque que só compartilha logo depois de um toque (o iPhone): `(pointer: coarse)` é verdadeiro e a folha de compartilhar recusa o pedido que chega com o toque já passado. Só a imagem usa isto.
        // Como texto, não como função: o `tsx` embrulha as funções com um auxiliar que não existe no navegador, e o script de início falharia em silêncio.
        await contexto.addInitScript({
          content: `const mq = window.matchMedia.bind(window);
window.matchMedia = (consulta) => consulta.includes("pointer: coarse") ? { matches: true, media: consulta, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } } : mq(consulta);
Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
Object.defineProperty(navigator, "share", { value: async () => { throw new DOMException("sem toque", "NotAllowedError"); }, configurable: true });`,
        });
        const page = await contexto.newPage();
        page.setDefaultTimeout(120_000);
        await entrar(page, baseUrl);

        // 1. o menu do roteiro com os três itens
        await page.goto(`${baseUrl}/roteiros/${curto.id}`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Mais opções" }).click();
        await page.getByRole("menu").waitFor({ state: "visible" });
        await page.waitForTimeout(900);
        await esconderPortal(page);
        const menu = nomeDe("Roteiro", "MenuMais");
        await page.screenshot({ path: menu });
        gravados.push(menu);

        // 2. o PDF pronto, com "Abrir"
        const download = page.waitForEvent("download");
        await page.getByRole("menu").getByRole("menuitem", { name: "Baixar em PDF" }).click();
        await download;
        await page.getByRole("status").filter({ hasText: "PDF do roteiro pronto" }).waitFor({ state: "visible" });
        await page.waitForTimeout(500);
        await esconderPortal(page);
        const pdfPronto = nomeDe("Roteiro", "PdfPronto");
        await page.screenshot({ path: pdfPronto });
        gravados.push(pdfPronto);

        // 3. a imagem pronta, esperando o segundo toque (o aparelho que só compartilha logo depois de um toque: a folha de compartilhar recusa, e o aviso pede "Guardar")
        await page.reload();
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Mais opções" }).click();
        await page.getByRole("menu").getByRole("menuitem", { name: "Guardar como imagem no celular" }).click();
        await page.getByRole("status").filter({ hasText: "A imagem do roteiro está pronta" }).waitFor({ state: "visible" });
        await page.waitForTimeout(500);
        await esconderPortal(page);
        const imagem = nomeDe("Roteiro", "ImagemParaGuardar");
        await page.screenshot({ path: imagem });
        gravados.push(imagem);

        // 4. o menu da agenda do Hoje (o roteiro de hoje é o destaque)
        await page.goto(`${baseUrl}/hoje`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: /^Mais opções: / }).first().click();
        await page.getByRole("menu").waitFor({ state: "visible" });
        await page.waitForTimeout(900);
        await esconderPortal(page);
        const agenda = nomeDe("Hoje", "AgendaMenu");
        await page.screenshot({ path: agenda });
        gravados.push(agenda);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(roteiros).where(inArray(roteiros.id, ids));
    await db().delete(videos).where(inArray(videos.id, [video.id]));
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
