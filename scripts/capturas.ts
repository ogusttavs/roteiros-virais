/**
 * Capturas do painel para revisao visual (etapa 12, ajuste 3 da revisao da
 * parte 1; nomes no padrao do design v2 desde a D2 parte 1, item 9 do
 * `PROXIMO.md`: `Tela.Estado.Largura.Modo`, como
 * `entregaveis/design-v2/entrega/telas/README.md`): as ferramentas de
 * navegador das sessoes de agente nao gravam arquivo, entao um pedido de
 * captura nunca sai de verdade. Este script sobe o Playwright direto, fora
 * da suite de testes, entra com o cliente de exemplo de limpeza e grava um
 * PNG de cada tela pedida, claro e escuro, a 390 (celular), 1024 (tablet) e
 * 1280 (desktop). Usa o cliente de limpeza, nao o de dentistas, porque
 * `scripts/semear.ts` deixa o de dentistas de proposito sem briefing
 * completo, para `briefing.spec.ts` exercitar o fluxo de onboarding
 * inteiro.
 *
 * Pre-requisitos, antes de rodar:
 * 1. `DATABASE_URL` do `.env` apontando para `roteiros_dev` (nunca
 *    `roteiros`, o banco de trabalho: `FLUXO.md`, "Um Postgres local,
 *    varias sessoes"; `resetarSchema` ja recusa esse nome, mas este script
 *    nao reseta nada, so le e grava um roteiro se faltar).
 * 2. `npm run db:seed` rodado uma vez contra esse banco.
 * 3. `npm run dev` rodando, na mesma porta que `CAPTURAS_URL` aponta
 *    (padrao `http://localhost:3000`).
 *
 * Uso: `npm run capturas -- <nome-da-etapa>` (ex.: `npm run capturas --
 * etapa-12`). Grava em `entregaveis/design/capturas/<nome-da-etapa>/`. O
 * comando no `package.json` ja forca `AI_PROVIDER=mock` (gerar um roteiro
 * de exemplo no seed nao deveria gastar credito real).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { getPool } from "../src/db";
import { clienteDoUsuario, salvarTema } from "../src/servicos/clientes";
import { gerarRoteiro, roteiroDeHoje } from "../src/servicos/roteiro";

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

/** Garante um roteiro de hoje para o cliente de seed, gerando um se faltar. */
async function garantirRoteiro(clienteId: number): Promise<number> {
  const existente = await roteiroDeHoje(clienteId);
  if (existente) return existente.id;

  const roteiro = await gerarRoteiro(clienteId, {
    origem: "livre",
    textoTema: "como organizar o guarda roupa em uma tarde sem gastar muito",
    objetivo: "conversao",
  });
  return roteiro.id;
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas -- <nome-da-etapa> (ex.: "etapa-12")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const cliente = await clienteDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(
      `cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra o banco desta sessao (roteiros_dev, nunca roteiros).`,
    );
  }

  const roteiroId = await garantirRoteiro(cliente.id);

  const telas = [
    { tela: "Hoje", estado: "Normal", caminho: "/hoje" },
    { tela: "Roteiro", estado: "Normal", caminho: `/roteiros/${roteiroId}` },
    { tela: "Gravacao", estado: "Normal", caminho: `/roteiros/${roteiroId}/gravar` },
    { tela: "Referencias", estado: "Normal", caminho: "/referencias" },
    { tela: "Historico", estado: "Normal", caminho: "/historico" },
    { tela: "Briefing", estado: "Normal", caminho: "/briefing" },
    { tela: "Conta", estado: "Normal", caminho: "/conta" },
  ];

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  try {
    for (const modo of MODOS) {
      await salvarTema(cliente.id, modo.colorScheme === "dark" ? "escuro" : "claro");

      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);

        for (const tela of telas) {
          await page.goto(`${baseUrl}${tela.caminho}`);
          await page.waitForLoadState("networkidle");
          const nomeArquivo = `${tela.tela}.${tela.estado}.${tamanho.rotulo}.${modo.rotulo}.png`;
          const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
          await page.screenshot({ path: caminhoArquivo, fullPage: true });
          arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
        }

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await salvarTema(cliente.id, "sistema");
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
