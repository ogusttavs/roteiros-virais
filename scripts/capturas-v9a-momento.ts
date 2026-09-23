/**
 * Capturas da folha "Gravar agora" (V9a, definição de pronto do
 * `PROXIMO.md`): dois estados (vazia, preenchida) nas três larguras do
 * design (390, 820, 1280) e nos dois modos. Mesmo padrão de
 * `scripts/capturas-v5b-tema-livre.ts`: monta a sessão pelo seed e usa o
 * Playwright para navegar e gravar PNG. Entra por `/hoje/tema-livre`
 * ("Estou num momento"), não por `/hoje`: a folha é a mesma dos dois
 * pontos de entrada, e essa rota não depende de `temas_dia` existir para
 * hoje (`/hoje` só mostra "Gravar agora" com os três temas ou o roteiro do
 * dia já prontos).
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v9a-momento -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { getPool } from "../src/db";

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

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v9a-momento -- <nome-da-etapa> (ex.: "pr-55")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function abrirFolha(page: Page): Promise<void> {
    await page.goto(`${baseUrl}/hoje/tema-livre`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Estou num momento" }).click();
    await page.getByRole("dialog", { name: "Gravar agora" }).waitFor({ state: "visible" });
  }

  try {
    // Vazia: a folha assim que abre, so com a instrucao de audio e os campos em branco.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await abrirFolha(page);

        const nomeArquivo = `GravarAgora.Vazia.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
        await contexto.close();
      }
    }

    // Preenchida: os tres campos com texto e um objetivo escolhido, pronta para "Escrever o roteiro".
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await abrirFolha(page);

        const folha = page.getByRole("dialog", { name: "Gravar agora" });
        await folha.getByLabel("Onde você está").fill("no aeroporto, cinco da manha");
        await folha.getByLabel("O que está acontecendo").fill("esperando o embarque para a feira de fornecedores");
        await folha.getByLabel("O que dá para mostrar").fill("a fila do check-in e a mala de amostras");
        await folha.getByRole("radio", { name: "Gente me chamar para comprar" }).click();

        const nomeArquivo = `GravarAgora.Preenchida.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
        await contexto.close();
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
