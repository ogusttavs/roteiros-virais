/**
 * Capturas do PR 2 da E38 ("o que entendemos da sua marca"): a seção do briefing em cada estado, o
 * cartão de perfis do PR 1 com a frase de cada motivo, e o campo do site na Conta, em 390 e 1280,
 * claro e escuro. Insere o estado direto no banco (mais rápido e determinístico do que esperar o job)
 * e depois navega de verdade. Nenhum dado de cliente: o cliente é o do seed, o site é `.test` e os
 * perfis são de exemplo (o repositório é público).
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`,
 * nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `npm run capturas:e38-pr2 -- <nome-da-pasta>` (ex.: "pr-108").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes, contextoMarca, contextoMarcaItens, perfisAnalisados } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;
const SECAO = "O que a IA tirou das suas redes e do seu site";

/** Meio-dia UTC de N dias atrás: a leitura é sempre de 10 dias atrás, e a próxima, 20 dias adiante (a tela nunca anuncia data passada). */
function haDias(n: number): Date {
  const data = new Date();
  data.setUTCHours(12, 0, 0, 0);
  return new Date(data.getTime() - n * 86_400_000);
}
const LEITURA_EM = haDias(10);

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

type Estado = {
  nome: string;
  preparar: (clienteId: number) => Promise<void>;
  /** Depois de abrir a página: interação opcional e o elemento a fotografar. */
  fotografar: (page: Page) => Promise<Locator>;
};

async function limparTudo(clienteId: number): Promise<void> {
  await db().delete(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId));
  await db().delete(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));
  await db().delete(perfisAnalisados).where(eq(perfisAnalisados.clienteId, clienteId));
  // Toda captura começa com as fontes de sempre (alguns estados as tiram da Conta).
  await db()
    .update(clientes)
    .set({ site: "https://loja-exemplo.test", perfis: { instagram: "loja.exemplo.limpeza", tiktok: "perfil.tiktok", youtube: null } })
    .where(eq(clientes.id, clienteId));
}

async function semearLeitura(clienteId: number): Promise<void> {
  await limparTudo(clienteId);
  await db().insert(contextoMarca).values({
    clienteId,
    ultimaLeituraOkEm: LEITURA_EM,
    ultimaTentativaEm: LEITURA_EM,
    fontes: [
      { tipo: "site", lida: true, quantidade: 3 },
      { tipo: "instagram", lida: true, quantidade: 8 },
    ],
  });
  await db().insert(contextoMarcaItens).values([
    { clienteId, categoria: "posta", origem: "instagram", texto: "Posta vídeos curtos de antes e depois em tecido claro.", estado: "confirmado", textoConfirmado: "Posta vídeos curtos de antes e depois em tecido claro." },
    { clienteId, categoria: "vende", origem: "site", texto: "O removedor de 500 ml agora vem com bico de spray, por R$ 49,90.", novidade: "mudou" },
    { clienteId, categoria: "rendeu", origem: "instagram", texto: "O teste no canto escondido do estofado rendeu quase seis vezes mais que os outros vídeos.", novidade: "alem_do_briefing" },
    { clienteId, categoria: "fala", origem: "site", texto: "Fala simples, sem nome difícil, como quem explica para uma vizinha.", estado: "corrigido", textoConfirmado: "Fala simples, sem nome difícil, como quem explica para uma vizinha." },
  ]);
}

async function abrirSecao(page: Page): Promise<Locator> {
  const secao = page.getByRole("region", { name: SECAO });
  try {
    await secao.waitFor({ state: "visible" });
  } catch (erro) {
    // Quase sempre é o login que não valeu (limite de taxa, senha do seed) ou a página que não carregou: diz onde a captura parou.
    const texto = (await page.locator("body").innerText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`a secao nao apareceu em ${page.url()}: "${texto}"`, { cause: erro });
  }
  return secao;
}

const ESTADOS: Estado[] = [
  { nome: "Itens", preparar: semearLeitura, fotografar: abrirSecao },
  {
    nome: "Corrigindo",
    preparar: semearLeitura,
    fotografar: async (page) => {
      const secao = await abrirSecao(page);
      await secao.getByRole("listitem").filter({ hasText: "teste no canto escondido" }).getByRole("button", { name: "Corrigir" }).click();
      await page.getByLabel("Corrigir o que a IA entendeu").waitFor({ state: "visible" });
      return secao;
    },
  },
  {
    nome: "Tirado",
    preparar: semearLeitura,
    fotografar: async (page) => {
      const secao = await abrirSecao(page);
      const item = secao.getByRole("listitem").filter({ hasText: "bico de spray" });
      await item.getByRole("button", { name: "Tirar" }).click();
      await item.getByText("Tirado. Não entra nos seus roteiros.").waitFor({ state: "visible" });
      // A ação terminou quando o Desfazer deixa de estar apagado: só então a linha está assentada.
      await item.getByRole("button", { name: /^Desfazer/ }).waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector('button[disabled][aria-label^="Desfazer"]'));
      return secao;
    },
  },
  {
    nome: "MudouComOQueValia",
    preparar: async (clienteId) => {
      await semearLeitura(clienteId);
      await db()
        .update(contextoMarcaItens)
        .set({ texto: "Agora também vende amaciante para tecido delicado.", textoConfirmado: "Vende só removedor de manchas de 500 ml.", estado: "para_confirmar", novidade: "mudou" })
        .where(and(eq(contextoMarcaItens.clienteId, clienteId), eq(contextoMarcaItens.categoria, "vende")));
    },
    fotografar: abrirSecao,
  },
  {
    nome: "ListaDosTirados",
    preparar: async (clienteId) => {
      await semearLeitura(clienteId);
      await db()
        .update(contextoMarcaItens)
        .set({ estado: "recusado", estadoAnterior: "para_confirmar" })
        .where(eq(contextoMarcaItens.texto, "O teste no canto escondido do estofado rendeu quase seis vezes mais que os outros vídeos."));
    },
    fotografar: async (page) => {
      const secao = await abrirSecao(page);
      await secao.getByText("1 item que você tirou").click();
      await secao.getByText("O que você tira não volta sozinho.").waitFor({ state: "visible" });
      return secao;
    },
  },
  {
    nome: "NaoSobrouNada",
    preparar: async (clienteId) => {
      await semearLeitura(clienteId);
      await db().update(contextoMarcaItens).set({ estado: "recusado", estadoAnterior: "para_confirmar" }).where(eq(contextoMarcaItens.clienteId, clienteId));
    },
    fotografar: abrirSecao,
  },
  {
    nome: "SemFonteComConfirmado",
    preparar: async (clienteId) => {
      await semearLeitura(clienteId);
      await db().update(clientes).set({ site: null, perfis: { instagram: null, tiktok: null, youtube: null } }).where(eq(clientes.id, clienteId));
    },
    fotografar: abrirSecao,
  },
  {
    nome: "Lendo",
    preparar: async (clienteId) => {
      await limparTudo(clienteId);
    },
    fotografar: abrirSecao,
  },
  {
    nome: "NaoLeu",
    preparar: async (clienteId) => {
      await limparTudo(clienteId);
      await db().insert(contextoMarca).values({
        clienteId,
        ultimaTentativaEm: LEITURA_EM,
        fontes: [
          { tipo: "site", lida: false, motivo: "bloqueado_pelo_site" },
          { tipo: "instagram", lida: false, motivo: "conta_restrita" },
        ],
      });
    },
    fotografar: abrirSecao,
  },
  {
    nome: "NadaClaro",
    preparar: async (clienteId) => {
      await limparTudo(clienteId);
      await db().insert(contextoMarca).values({
        clienteId,
        ultimaLeituraOkEm: LEITURA_EM,
        ultimaTentativaEm: LEITURA_EM,
        fontes: [
          { tipo: "site", lida: true, quantidade: 1 },
          { tipo: "instagram", lida: false, motivo: "sem_videos" },
        ],
      });
    },
    fotografar: abrirSecao,
  },
  {
    nome: "PerfisPorMotivo",
    preparar: async (clienteId) => {
      await limparTudo(clienteId);
      await db().insert(perfisAnalisados).values([
        { clienteId, perfilCitadoId: null, origem: "citado", rede: "instagram", handle: "natgeo", existeNaRede: true, leitura: "Posta fotos e vídeos curtos de natureza, sempre com uma legenda que conta uma história." },
        { clienteId, perfilCitadoId: null, origem: "citado", rede: "tiktok", handle: "perfil.tiktok", existeNaRede: false, motivo: "tiktok_desligado" },
        { clienteId, perfilCitadoId: null, origem: "citado", rede: "instagram", handle: "perfil.pessoal", existeNaRede: false, motivo: "conta_restrita" },
        { clienteId, perfilCitadoId: null, origem: "citado", rede: "youtube", handle: "@canalsemvideo", existeNaRede: false, motivo: "sem_videos" },
        { clienteId, perfilCitadoId: null, origem: "citado", rede: "instagram", handle: "perfil.errado", existeNaRede: false, motivo: "nao_encontrado" },
      ]);
    },
    fotografar: async (page) => page.getByRole("region", { name: "O que a IA viu nos perfis" }),
  },
];

/**
 * Recorta a região do elemento na página inteira: `element.screenshot` rola até o elemento e deixa a
 * barra fixa do topo por cima dele. E esconde o portal do Next em desenvolvimento (selo "Issue").
 */
async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // No topo da página, as barras fixas ficam onde ficam de verdade (no topo), nunca no meio do recorte;
  // e as fixas (o topo, a cápsula de abas de baixo) saem do recorte, porque na página inteira a de baixo
  // cairia por cima do conteúdo.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: arquivo,
    fullPage: true,
    clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height },
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
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: npm run capturas:e38-pr2 -- <nome-da-pasta> (ex.: "pr-108")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  }
  await db()
    .update(clientes)
    .set({ site: "https://loja-exemplo.test", perfis: { instagram: "loja.exemplo.limpeza", tiktok: "perfil.tiktok", youtube: null } })
    .where(eq(clientes.id, cliente.id));

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);

        for (const estado of ESTADOS) {
          await estado.preparar(cliente.id);
          await page.goto(`${baseUrl}/briefing`);
          const alvo = await estado.fotografar(page);
          const arquivo = path.join(pastaDestino, `Briefing.ContextoMarca.${estado.nome}.${tamanho.rotulo}.${modo.rotulo}.png`);
          await fotografarElemento(page, alvo, arquivo);
          gravados.push(arquivo);
        }

        // O campo do site na Conta, no mesmo lugar dos perfis.
        await limparTudo(cliente.id);
        await page.goto(`${baseUrl}/conta`);
        const campo = page.getByLabel("O site da sua marca, se tiver");
        await campo.waitFor({ state: "visible" });
        const arquivoConta = path.join(pastaDestino, `Conta.Site.${tamanho.rotulo}.${modo.rotulo}.png`);
        await fotografarElemento(page, page.locator("form").first(), arquivoConta);
        gravados.push(arquivoConta);

        // O endereço que não parece site: o erro mora no próprio campo, e o foco vai para lá (nada é salvo).
        await campo.fill("isso nao e um site");
        await page.getByRole("button", { name: "salvar", exact: true }).click();
        await page.getByText("Esse endereço não parece um site válido").waitFor({ state: "visible" });
        const arquivoContaInvalido = path.join(pastaDestino, `Conta.SiteInvalido.${tamanho.rotulo}.${modo.rotulo}.png`);
        await fotografarElemento(page, page.locator("form").first(), arquivoContaInvalido);
        gravados.push(arquivoContaInvalido);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Deixa o cliente de seed com a leitura completa, como um uso normal.
  await semearLeitura(cliente.id);
  console.log(`${gravados.length} captura(s) gravada(s) em ${pastaDestino}`);
  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
