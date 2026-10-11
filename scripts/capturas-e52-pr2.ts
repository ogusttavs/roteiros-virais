/**
 * Capturas da E52 parte 2 (a leitura dos vídeos longos): o bloco "Vídeos longos" na aba Custos do admin (o que a Groq, o proxy e a IA gastaram, por ramo) e a seção do ramo com os
 * longos já transcritos e lidos, em 390 e 1280, claro e escuro. Nenhum dado de cliente: o ramo é o da limpeza do seed e tudo é inventado e marcado "[exemplo]". O script escreve os
 * exemplos no banco (nenhuma coleta, nenhuma IA), tira as fotos e apaga o que criou.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr2.ts <nome-da-pasta>` (ex.: "pr-e52-2").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { custosExternos, execucoesJob, geracoesIA, nichos, videos } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const USUARIO_DA_MARCA = "seed-cliente-limpeza";
const DIA_MS = 24 * 60 * 60 * 1000;

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
      if ((posicao === "fixed" || posicao === "sticky") && !el.closest("table")) el.style.visibility = "hidden";
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

function lista(...inicios: number[]): string {
  const nomes = ["Abertura", "O erro mais comum", "Como fazer do jeito certo", "O que usar", "Fechamento", "Perguntas"];
  return ["Neste vídeo eu mostro o passo a passo completo.", "", ...inicios.map((s, i) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} ${nomes[i % nomes.length]}`)].join("\n");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e52-pr2.ts <nome-da-pasta> (ex.: "pr-e52-2")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO_DA_MARCA);
  if (!marca?.nichoId) throw new Error(`marca de seed "${USUARIO_DA_MARCA}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);
  const [setor] = await db().select({ slug: nichos.slug }).from(nichos).where(inArray(nichos.id, [marca.nichoId]));
  const [outroRamo] = await db().insert(nichos).values({ slug: `captura-e52-outro`, nome: "[exemplo] Ramo de odontologia", termos: [] }).returning();

  const agora = Date.now();
  const exemplos = [
    { id: "cap-e52-1", titulo: "[exemplo] Como tirar mancha do sofá sem estragar o tecido", s: 612, views: 482_000, dias: 3, descricao: lista(0, 70, 190, 330, 480, 560) },
    { id: "cap-e52-2", titulo: "[exemplo] 7 erros ao limpar o estofado", s: 540, views: 360_000, dias: 6, descricao: lista(0, 90, 210, 400) },
    { id: "cap-e52-3", titulo: "[exemplo] Limpeza de tapete: o passo a passo de quem faz todo dia", s: 905, views: 275_000, dias: 9, descricao: lista(0, 120, 300, 520, 700, 820) },
    { id: "cap-e52-4", titulo: "[exemplo] Produto caseiro funciona mesmo?", s: 430, views: 190_000, dias: 14, descricao: null },
    { id: "cap-e52-5", titulo: "[exemplo] Bastidores de um dia de limpeza pós-obra", s: 1320, views: 120_000, dias: 21, descricao: lista(0, 180, 420, 800, 1100) },
  ];

  const gravados: string[] = [];
  const execucoesCriadas: number[] = [];
  const browser = await chromium.launch();
  try {
    await db()
      .insert(videos)
      .values(
        exemplos.map((e, i) => ({
          plataforma: "youtube" as const,
          idExterno: e.id,
          url: `https://exemplo.invalido/${e.id}`,
          nichoId: marca.nichoId!,
          titulo: e.titulo,
          descricao: e.descricao,
          views: e.views,
          duracaoS: e.s,
          foraDaCurva: String(8 - i),
          publicadoEm: new Date(agora - e.dias * DIA_MS),
          idioma: "pt",
          origem: "coleta" as const,
          transcricao: i <= 2 ? "[exemplo] texto lido" : null,
          transcritoEm: i <= 2 ? new Date(agora - DIA_MS) : null,
          analiseLongaEm: i <= 1 ? new Date(agora - DIA_MS) : null,
          analiseLonga:
            i <= 1
              ? {
                  versaoPrompt: "1.0.0",
                  origemDosCapitulos: "descricao" as const,
                  assunto: "[exemplo]",
                  abertura: { promessa: "[exemplo]", entregaAteS: 30, tipo: "resultado" as const },
                  capitulos: [],
                  lacos: [],
                  ondeSairia: [],
                  fechamento: { oQueFaz: "[exemplo]", apontaParaProximoVideo: false },
                  porQueFuncionou: "[exemplo]",
                }
              : null,
        })),
      );

    // O que a rotina gastou: duas rodadas, em dois ramos.
    const [rodada] = await db().insert(execucoesJob).values({ nome: "ler-longos", status: "ok", terminadoEm: new Date(), iniciadoEm: new Date(agora - 2 * DIA_MS) }).returning();
    execucoesCriadas.push(rodada.id);
    await db()
      .insert(custosExternos)
      .values([
        { fonte: "groq", custoUsd: "0.024000", unidades: "36.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: marca.nichoId!, execucaoId: rodada.id },
        { fonte: "proxy", custoUsd: "0.002100", unidades: "21.000", unidade: "megabytes", origemDoCusto: "estimado", ramoId: marca.nichoId!, execucaoId: rodada.id },
        { fonte: "groq", custoUsd: "0.008000", unidades: "12.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: outroRamo.id, execucaoId: rodada.id },
      ]);
    await db()
      .insert(geracoesIA)
      .values([
        { tarefa: "extrairVideoLongo", versaoPrompt: "1.0.0", modelo: "mock", entradas: { videoId: 0 }, ramoId: marca.nichoId!, custoUsd: "0.013000" },
        { tarefa: "extrairVideoLongo", versaoPrompt: "1.0.0", modelo: "mock", entradas: { videoId: 0 }, ramoId: marca.nichoId!, custoUsd: "0.011000" },
        { tarefa: "extrairVideoLongo", versaoPrompt: "1.0.0", modelo: "mock", entradas: { videoId: 0 }, ramoId: outroRamo.id, custoUsd: "0.006000" },
      ] as never);

    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        // O servidor de desenvolvimento compila cada tela na primeira visita: 30 s é pouco.
        page.setDefaultTimeout(120_000);
        await entrarComoAdmin(page, baseUrl);

        await page.goto(`${baseUrl}/admin/custos`);
        const bloco = page.locator('[data-bloco="longos"]');
        await bloco.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const fotoCustos = path.join(pastaDestino, `AdminCustos.VideosLongos.${tamanho.rotulo}.${modo.rotulo}.png`);
        await fotografarElemento(page, bloco, fotoCustos);
        gravados.push(fotoCustos);

        await page.goto(`${baseUrl}/admin/nichos/${setor.slug}`);
        const secao = page.locator("[data-longos-do-setor]");
        await secao.waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        const fotoSetor = path.join(pastaDestino, `AdminNicho.VideosLongos.Lidos.${tamanho.rotulo}.${modo.rotulo}.png`);
        await fotografarElemento(page, secao, fotoSetor);
        gravados.push(fotoSetor);
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await db().delete(videos).where(inArray(videos.idExterno, exemplos.map((e) => e.id)));
    await db().delete(geracoesIA).where(inArray(geracoesIA.ramoId, [marca.nichoId!, outroRamo.id]));
    if (execucoesCriadas.length > 0) {
      await db().delete(custosExternos).where(inArray(custosExternos.execucaoId, execucoesCriadas));
      await db().delete(execucoesJob).where(inArray(execucoesJob.id, execucoesCriadas));
    }
    await db().delete(nichos).where(inArray(nichos.id, [outroRamo.id]));
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
