/**
 * Capturas do item 3 da E53 (a foto das notícias do setor, o nome do veículo que quebra só entre palavras e a notícia de um assunto da marca que vira a origem do roteiro), em 390 e 1280, claro e escuro:
 * a capa de Notícias (uma do setor com a foto e o crédito, uma do setor sem foto e com o nome longo, uma de um assunto), o Tema livre com a notícia de um assunto presa e o roteiro com "Veio de uma notícia"
 * (a de um assunto e a do setor). Nenhum dado de cliente: a marca é a da limpeza do seed. As fotos são interceptadas no navegador (o endereço de exemplo não existe), o script põe as notícias e os roteiros
 * de exemplo e devolve tudo como estava.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e53-item3.ts <nome-da-pasta>` (ex.: "pr-150").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { assuntosDaMarca, noticias, noticiasDoAssunto, roteiros } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";
import { inicioDoDiaEmSaoPaulo } from "../src/servicos/noticias-do-dia";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;

const TITULO_SETOR_FOTO = `Venda de produtos multiuso cresce no trimestre, diz associação do setor`;
const TITULO_SETOR_SEM_FOTO = `Procon alerta para o rótulo que promete mais do que o produto faz`;
const TITULO_ASSUNTO = `Debate esquenta a eleição e divide os candidatos`;
const TEXTO_ASSUNTO = "política";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const CONTEUDO = {
  titulo: "O que o debate muda para a sua loja",
  duracaoS: 30,
  gancho: "Viu o debate de ontem? Tem uma coisa nele que mexe com o seu preço.",
  corpo: "Mostre o balcão e a etiqueta de preço. Diga em uma frase o que mudou e o que você fez na sua loja por causa disso, sem prometer nada que não possa cumprir.",
  fechamento: "Mostre a etiqueta nova no produto.",
  chamadaFinal: "Se quiser saber o preço de hoje, me chama no direct.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no balcão da loja",
  edicao: {
    textoNaTela: [{ quando: "0 a 2 s", onde: "no topo", oQue: "o debate mexeu no seu preço?" }],
    ritmoDeCorte: "rápido, um corte a cada 3 segundos",
    recursos: ["a etiqueta de preço em primeiro plano"],
    audio: null,
    referencia: null,
  },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

/** Uma foto de mentira, neutra, para as notícias de exemplo (o endereço não existe: o navegador responde com isto). */
const FOTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a7f73"/><stop offset="1" stop-color="#4f4740"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><circle cx="600" cy="130" r="60" fill="#d9cfc3" opacity="0.5"/><rect x="90" y="250" width="420" height="120" rx="12" fill="#d9cfc3" opacity="0.35"/></svg>';

async function limparTela(page: Page): Promise<void> {
  // A entrada da tela é uma transição de opacidade: sem esperar, a captura sai desbotada.
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
}

async function fotografarTela(page: Page, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: arquivo, fullPage: true });
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
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e53-item3.ts <nome-da-pasta> (ex.: "pr-150")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const [jaTem] = await db().select({ id: assuntosDaMarca.id }).from(assuntosDaMarca).where(and(eq(assuntosDaMarca.clienteId, marca.id), eq(assuntosDaMarca.texto, TEXTO_ASSUNTO)));
  if (jaTem) throw new Error(`a marca de seed ja tem o assunto "${TEXTO_ASSUNTO}"; o script nao mexe em assunto que existia.`);

  const hoje = (minutos: number) => new Date(Math.max(Date.now() - minutos * 60 * 1000, inicioDoDiaEmSaoPaulo(new Date()).getTime() + 60 * 1000));
  const sufixo = Date.now();

  const [assunto] = await db().insert(assuntosDaMarca).values({ clienteId: marca.id, texto: TEXTO_ASSUNTO, termos: ["eleição", "Câmara"] }).returning();
  const [noticiaDoAssunto] = await db()
    .insert(noticiasDoAssunto)
    .values({
      assuntoId: assunto.id,
      titulo: TITULO_ASSUNTO,
      veiculo: "Agência do Consumidor",
      url: `https://exemplo.invalido/captura-assunto-${sufixo}`,
      publicadoEm: hoje(20),
      imagemUrl: `https://exemplo.invalido/captura-assunto-${sufixo}.jpg`,
      imagemCredito: "Foto: Agência do Consumidor",
      resumoNosso: "Os candidatos se enfrentaram em um debate com troca de acusações.",
      origem: "rss",
    })
    .returning();
  const [setorComFoto, setorSemFoto] = await db()
    .insert(noticias)
    .values([
      {
        nichoId: marca.nichoId,
        titulo: TITULO_SETOR_FOTO,
        url: `https://exemplo.invalido/captura-setor-foto-${sufixo}`,
        fonte: "Jornal Exemplo",
        publicadoEm: hoje(40),
        resumo: "Associação do setor registrou alta nas vendas de produtos multiuso no trimestre.",
        relevante: true,
        angulo: "Mostre a sua rotina usando o produto e explique o que faz ele render mais.",
        imagemUrl: `https://exemplo.invalido/captura-setor-${sufixo}.jpg`,
        imagemCredito: "Foto: Jornal Exemplo",
      },
      {
        nichoId: marca.nichoId,
        titulo: TITULO_SETOR_SEM_FOTO,
        url: `https://exemplo.invalido/captura-setor-sem-foto-${sufixo}`,
        fonte: "Agência do Consumidor",
        publicadoEm: hoje(90),
        resumo: "O órgão de defesa do consumidor orienta a conferir o que está escrito no rótulo.",
        relevante: true,
        angulo: null,
      },
    ])
    .returning();

  async function inserirRoteiro(extra: Partial<typeof roteiros.$inferInsert>): Promise<number> {
    const [linha] = await db()
      .insert(roteiros)
      .values({
        clienteId: marca.id,
        data: hojeISO(),
        tema: "O que o debate muda para a sua loja",
        origem: "livre",
        objetivo: "alcance",
        formato: "reels",
        conteudo: CONTEUDO,
        status: "gerado",
        ...extra,
      })
      .returning({ id: roteiros.id });
    return linha.id;
  }
  const roteiroDoAssunto = await inserirRoteiro({
    noticiaDoAssunto: { id: noticiaDoAssunto.id, titulo: TITULO_ASSUNTO, veiculo: "Agência do Consumidor", url: noticiaDoAssunto.url, publicadoEm: noticiaDoAssunto.publicadoEm!.toISOString() },
  });
  const roteiroDoSetor = await inserirRoteiro({ noticiaId: setorComFoto.id, tema: "O que o setor está vendendo agora" });

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        // A foto de exemplo: o endereço não existe, o navegador responde com uma imagem neutra.
        await contexto.route("https://exemplo.invalido/**/*.jpg", (rota) => rota.fulfill({ status: 200, contentType: "image/svg+xml", body: FOTO_SVG }));
        await contexto.route("https://exemplo.invalido/*.jpg", (rota) => rota.fulfill({ status: 200, contentType: "image/svg+xml", body: FOTO_SVG }));
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrar(page, baseUrl);

        // 1. a capa de Notícias: a do setor com a foto e o crédito, a do setor sem foto (o nome longo do veículo), a de um assunto
        await page.goto(`${baseUrl}/noticias`);
        await page.locator("article[data-noticia]").first().waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const capa = nomeDe("Noticias", "Capa");
        await fotografarTela(page, capa);
        gravados.push(capa);

        // 2. o Tema livre com a notícia de um assunto presa ("A notícia"), que veio do botão da própria capa
        await page.locator("article[data-noticia^='a-']").first().getByRole("button", { name: "Criar roteiro com esta notícia" }).click();
        await page.waitForURL(/\/criar\/tema-livre\?noticiaAssuntoId=\d+/);
        await page.getByRole("heading", { name: "Criar vídeo com esta notícia" }).waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const livre = nomeDe("TemaLivre", "NoticiaDoAssunto");
        await fotografarTela(page, livre);
        gravados.push(livre);

        // 3. o roteiro com "Veio de uma notícia": a de um assunto, e a do setor
        await page.goto(`${baseUrl}/roteiros/${roteiroDoAssunto}`);
        await page.locator("[data-noticia-de-origem]").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const doAssunto = nomeDe("Roteiro", "VeioDaNoticiaDoAssunto");
        await fotografarTela(page, doAssunto);
        gravados.push(doAssunto);
        const linhaAssunto = nomeDe("Roteiro", "LinhaDaNoticiaDoAssunto");
        await fotografarElemento(page, page.locator("[data-noticia-de-origem]"), linhaAssunto);
        gravados.push(linhaAssunto);

        await page.goto(`${baseUrl}/roteiros/${roteiroDoSetor}`);
        await page.locator("[data-noticia-de-origem]").waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const doSetor = nomeDe("Roteiro", "VeioDaNoticiaDoSetor");
        await fotografarTela(page, doSetor);
        gravados.push(doSetor);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(roteiros).where(inArray(roteiros.id, [roteiroDoAssunto, roteiroDoSetor]));
    await db().delete(noticias).where(inArray(noticias.id, [setorComFoto.id, setorSemFoto.id]));
    await db().delete(assuntosDaMarca).where(eq(assuntosDaMarca.id, assunto.id));
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
