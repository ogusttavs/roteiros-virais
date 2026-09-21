/**
 * Capturas da V6, Referências no design v2 (D2 parte 3a, `PROXIMO.md`): os
 * seis estados (normal, filtrar, detalhes, carregando, vazio, erro) nas três
 * larguras da força-tarefa da viagem (390, 820, 1280, como a V5 e a V5b) e
 * nos dois modos. Script próprio, fora da suíte de testes, mesmo padrão de
 * `scripts/capturas-v5b-tema-livre.ts`: monta o fixture direto no banco e
 * usa o Playwright para navegar e gravar PNG.
 *
 * `carregando` e `erro` não dão para simular com `page.route` interceptando
 * rede: os dois são decididos pelo Server Component durante a renderização
 * no servidor (o `loading.tsx`, o Suspense enquanto ele ainda não terminou;
 * o `error.tsx`, quando ele lança), nunca por uma resposta HTTP que o
 * cliente veria para poder interceptar (achado rodando este script a
 * primeira vez: atrasar a navegação com `page.route` só mostrava a tela
 * anterior por mais tempo, nunca o `loading.tsx` de verdade). O script cria
 * uma rota efêmera por vez dentro de `referencias/`, ou uma página que nunca
 * termina de carregar (`await new Promise(() => {})`, para `loading.tsx`) ou
 * uma que só lança (para `error.tsx`); os dois arquivos reais da tela
 * respondem, sem gatilho de teste nenhum no código de produção; a rota some
 * ao final de cada bloco.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v6-referencias -- <nome-da-etapa>`.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { contas, videos } from "../src/db/schema";
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

const PASTA_REFERENCIAS = path.join(__dirname, "..", "src", "app", "(painel)", "(completo)", "referencias");

/**
 * Cria `referencias/<nome>/page.tsx` com o corpo dado, roda `tarefa`, e
 * apaga a pasta ao final (sucesso ou falha). Sem underscore no nome: o App
 * Router trata pasta prefixada com "_" como pasta privada, fora do
 * roteamento (achado rodando este script pela primeira vez: a rota nunca
 * compilava, o estado nunca aparecia).
 */
async function comRotaEfemera(nome: string, corpoDoArquivo: string, tarefa: () => Promise<void>): Promise<void> {
  const pasta = path.join(PASTA_REFERENCIAS, nome);
  await mkdir(pasta, { recursive: true });
  await writeFile(path.join(pasta, "page.tsx"), corpoDoArquivo, "utf8");
  try {
    await tarefa();
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

/** Fora da curva de verdade (>= 1,5x), com velocidade nula num deles para a frase das 72 horas aparecer. */
async function garantirVideosDeReferencia(): Promise<void> {
  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente?.nichoId) throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira "npm run db:seed".`);
  const nichoId = cliente.nichoId;

  const contasDoNicho = await db().select().from(contas).where(eq(contas.nichoId, nichoId)).limit(2);
  const [contaA] = contasDoNicho;
  const contaB = contasDoNicho[1] ?? contaA;
  await db()
    .update(contas)
    .set({ medianaViews: "5000", medianaOrigem: "conta" })
    .where(eq(contas.id, contaA.id));
  if (contaB.id !== contaA.id) {
    await db().update(contas).set({ medianaViews: "8000", medianaOrigem: "conta" }).where(eq(contas.id, contaB.id));
  }

  const base = {
    gancho: "Abre com a mao ja esfregando a mancha, sem falar por dois segundos.",
    estrutura: "Aplica o produto sem cortar o video, falando o tempo de espera em voz alta.",
    fechamento: "Resumo do antes e depois.",
    chamadaFinal: "Comenta se voce ja passou por isso.",
    porQueFuncionou: "A pessoa ve o problema dela na tela nos dois primeiros segundos e fica para saber se resolve.",
  };

  const fixtures = [
    {
      idExterno: "captura-v6-referencias-1",
      plataforma: "instagram" as const,
      contaId: contaA.id,
      titulo: "a mancha que volta: o erro esta na ordem, nao no produto",
      views: 128400,
      foraDaCurva: "25.5",
      velocidade: "4120",
      formato: "fala_para_camera" as const,
      assunto: "mancha em sofa de camurca",
    },
    {
      idExterno: "captura-v6-referencias-2",
      plataforma: "tiktok" as const,
      contaId: contaB.id,
      titulo: "testei o produto num canto escondido do sofa antes de tudo",
      views: 42900,
      foraDaCurva: "4.1",
      velocidade: "890",
      formato: "podcast" as const,
      assunto: "teste de produto no sofa",
    },
    {
      idExterno: "captura-v6-referencias-3",
      plataforma: "youtube" as const,
      contaId: contaA.id,
      titulo: "antes e depois do sofa de camurca, sem cortes",
      views: 18720,
      foraDaCurva: "2.8",
      velocidade: null,
      formato: "esquete" as const,
      assunto: "antes e depois do sofa",
    },
  ];

  for (const [indice, f] of fixtures.entries()) {
    const idExterno = f.idExterno;
    const existente = await db().select().from(videos).where(eq(videos.idExterno, idExterno));
    if (existente.length > 0) continue;

    await db()
      .insert(videos)
      .values({
        plataforma: f.plataforma,
        idExterno,
        url: `https://exemplo.invalido/${idExterno}`,
        nichoId,
        contaId: f.contaId,
        titulo: f.titulo,
        views: f.views,
        foraDaCurva: f.foraDaCurva,
        velocidade: f.velocidade,
        publicadoEm: new Date(Date.now() - indice * 24 * 60 * 60 * 1000),
        idioma: "pt",
        analise: { ...base, formato: f.formato, assunto: f.assunto } as never,
      });
  }
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v6-referencias -- <nome-da-etapa> (ex.: "pr-52")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  await garantirVideosDeReferencia();

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function capturar(page: Page, estado: string, rotulo: string, modo: string): Promise<void> {
    const nomeArquivo = `Referencias.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  try {
    // Normal
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/referencias`);
        await page.waitForLoadState("networkidle");
        await capturar(page, "Normal", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // Filtrar
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/referencias`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Filtrar" }).click();
        await page.getByRole("dialog", { name: "Filtrar" }).waitFor({ state: "visible" });
        await capturar(page, "Filtrar", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // Detalhes
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/referencias`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Ver detalhes" }).first().click();
        await page.getByRole("dialog", { name: "Por que esse funcionou" }).waitFor({ state: "visible" });
        await capturar(page, "Detalhes", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // Carregando: rota efemera que nunca termina de renderizar (suspende para
    // sempre), capturada pelo loading.tsx de verdade da tela.
    await comRotaEfemera(
      "captura-carregando-efemera",
      "export default async function CapturaCarregando() {\n  await new Promise(() => {});\n}\n",
      async () => {
        for (const modo of MODOS) {
          for (const tamanho of TAMANHOS) {
            const contexto = await browser.newContext({
              viewport: { width: tamanho.largura, height: tamanho.altura },
              colorScheme: modo.colorScheme,
            });
            const page = await contexto.newPage();
            await entrar(page, baseUrl);
            const navegacao = page.goto(`${baseUrl}/referencias/captura-carregando-efemera`);
            await page.waitForSelector('[aria-busy="true"], .skeleton, [class*="skeleton" i]', { timeout: 10000 }).catch(() => {});
            await capturar(page, "Carregando", tamanho.rotulo, modo.rotulo);
            navegacao.catch(() => {});
            await contexto.close();
          }
        }
      },
    );

    // Vazio: busca por um assunto que nao existe em nenhum video.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/referencias?busca=${encodeURIComponent("assunto que nao existe em nenhum video de teste")}`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("heading", { name: "Nada fora da curva com esses filtros" }).waitFor({ state: "visible" });
        await capturar(page, "Vazio", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // Erro: rota efemera que so lanca, capturada pelo error.tsx de verdade da tela.
    await comRotaEfemera(
      "captura-erro-efemera",
      'export default function CapturaErro(): never {\n  throw new Error("erro forcado so para a captura da V6, apagado ao final do script");\n}\n',
      async () => {
        for (const modo of MODOS) {
          for (const tamanho of TAMANHOS) {
            const contexto = await browser.newContext({
              viewport: { width: tamanho.largura, height: tamanho.altura },
              colorScheme: modo.colorScheme,
            });
            const page = await contexto.newPage();
            await entrar(page, baseUrl);
            await page.goto(`${baseUrl}/referencias/captura-erro-efemera`);
            await page.getByRole("heading", { name: "Estes são os de ontem" }).waitFor({ state: "visible", timeout: 20000 });
            await capturar(page, "Erro", tamanho.rotulo, modo.rotulo);
            await contexto.close();
          }
        }
      },
    );
  } finally {
    await browser.close();
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  // comRotaEfemera ja limpa a pasta efemera no proprio finally, mesmo em erro.
  console.error(erro);
  process.exitCode = 1;
});
