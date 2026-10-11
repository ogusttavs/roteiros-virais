/**
 * Capturas da E54 parte 4 (as "Pesquisas na hora" na aba Custos do admin): a seção com o resumo, o estimado ao lado do medido por tamanho e uma linha por pesquisa (pronta, mais a fundo com
 * a premissa que não batia, sem dado confiável e erro), em 390 e 1280, claro e escuro. Nenhum dado de cliente: a marca é a da limpeza do seed, e os pedidos são inventados. O script escreve
 * as pesquisas de exemplo direto no banco (nenhuma busca, nenhuma IA), tira as fotos e apaga o que criou.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e54-pr4.ts <nome-da-pasta>` (ex.: "pr-e54-4").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { pesquisasNaHora, type AchadoDaPesquisa } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const USUARIO_DA_MARCA = "seed-cliente-limpeza";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const posicao = getComputedStyle(el).position;
      // A barra do alto é "sticky": numa captura de página inteira ela cobre o título, e não existe na tela de verdade.
      if (posicao === "fixed" || posicao === "sticky") el.style.visibility = "hidden";
    }
  });
}

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
}

async function entrarComoAdmin(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e54-pr4.ts <nome-da-pasta> (ex.: "pr-e54-4")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO_DA_MARCA);
  if (!marca) throw new Error(`marca de seed "${USUARIO_DA_MARCA}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);

  const achados: AchadoDaPesquisa[] = [1, 2, 3, 4, 5, 6].map((id) => ({
    id,
    texto: `[exemplo] Dado ${id}.`,
    fonteNome: "IBGE",
    fonteTipo: "oficial",
    url: `https://www.ibge.gov.br/exemplo-${id}`,
    titulo: null,
    dataDaPagina: "2026-09-10",
    dataTexto: "2026-09-10",
    antigo: false,
    citacao: `[exemplo] Trecho ${id}.`,
  }));
  const agora = Date.now();
  const base = { clienteId: marca.id, status: "pronta" as const, achados, selecionados: [1, 2, 3], confirmadaEm: new Date(agora) };
  const criadas: number[] = [];

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    const linhas = await db()
      .insert(pesquisasNaHora)
      .values([
        { ...base, pedido: "quanto subiu o preço dos produtos de limpeza este ano", buscas: 4, custoUsd: "0.080000", criadoEm: new Date(agora - 50 * 60_000), terminadoEm: new Date(agora - 50 * 60_000 + 54_000) },
        {
          ...base,
          pedido: "o que mudou na regra da embalagem dos produtos de limpeza",
          profundidade: "aprofundada",
          buscas: 9,
          custoUsd: "0.190000",
          criadoEm: new Date(agora - 3 * 3_600_000),
          terminadoEm: new Date(agora - 3 * 3_600_000 + 96_000),
          premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: [exemplo].", anguloSugerido: null, achadoIds: [1] },
          decisaoDaPremissa: "manter",
          perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] },
          posicaoDaPessoa: "Dos dois",
        },
        { ...base, pedido: "decreto novo sobre rótulo de saneante", status: "sem_achados" as const, achados: [], selecionados: [], confirmadaEm: null, buscas: 3, custoUsd: "0.050000", criadoEm: new Date(agora - 6 * 3_600_000), terminadoEm: new Date(agora - 6 * 3_600_000 + 41_000) },
        { ...base, pedido: "preço do galão de cloro no atacado", status: "erro" as const, achados: [], selecionados: [], confirmadaEm: null, buscas: 0, custoUsd: "0", motivo: "A pesquisa não terminou.", criadoEm: new Date(agora - 26 * 3_600_000), terminadoEm: new Date(agora - 26 * 3_600_000 + 4_000) },
        { ...base, pedido: "quanto custa um frasco de desengordurante, em média", buscas: 3, custoUsd: "0.060000", criadoEm: new Date(agora - 30 * 3_600_000), terminadoEm: new Date(agora - 30 * 3_600_000 + 47_000), confirmadaEm: null },
      ])
      .returning({ id: pesquisasNaHora.id });
    criadas.push(...linhas.map((l) => l.id));

    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (estado: string) => path.join(pastaDestino, `AdminCustos.PesquisasNaHora.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrarComoAdmin(page, baseUrl);

        await page.goto(`${baseUrl}/admin/custos`);
        const secao = page.locator('[data-bloco="pesquisas-na-hora"]');
        await secao.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const foto = nomeDe("Secao");
        await fotografarElemento(page, secao, foto);
        gravados.push(foto);
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    if (criadas.length > 0) await db().delete(pesquisasNaHora).where(inArray(pesquisasNaHora.id, criadas));
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
