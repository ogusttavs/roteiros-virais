/**
 * Capturas da V5b, Tema livre no design v2 (definição de pronto do
 * `PROXIMO.md`): os cinco estados (proposta, esperando, naMeta,
 * abaixoDaMeta, erro) nas três larguras do design (390, 820, 1280) e nos
 * dois modos, mais uma captura com o teclado aberto a 390 (viewport
 * reduzida a 390x500, o botão de avaliar visível). Script próprio, fora da
 * suíte de testes, no mesmo padrão de `scripts/capturas-v5-pele-nova.ts`:
 * monta o fixture direto no banco e usa o Playwright para navegar e gravar
 * PNG.
 *
 * `esperando` e `erro` não são resultado de digitar e esperar de verdade
 * (o mock responde rápido demais para o clique real garantir a foto certa):
 * `esperando` atrasa a resposta da Server Action de propósito
 * (`page.route`, mesmo truque de `capturas-v3-marcas.ts`, "Casca.Trocando")
 * e `erro` intercepta a mesma rota para devolver falha.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v5b-tema-livre -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { contas, videos } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;
const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";
const TEMA_COM_PROVA = "como tirar mancha de sofa de camurca sem estragar o tecido";
const TEMA_SEM_PROVA = "um assunto qualquer sem nenhuma evidencia guardada";

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

/** Prova suficiente (V2b, item 8) para o ângulo sugerido aparecer em `abaixoDaMeta`. */
async function garantirVideosDeProva(): Promise<void> {
  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente?.nichoId) throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira "npm run db:seed".`);

  const contasDoNicho = await db().select().from(contas).where(eq(contas.nichoId, cliente.nichoId)).limit(2);
  const [contaA] = contasDoNicho;
  const contaB = contasDoNicho[1] ?? contaA;

  const analise = {
    assunto: "mancha em sofa de camurca",
    gancho: "esse produto tira qualquer mancha do sofa",
    estrutura: "mostra o antes e o depois",
    fechamento: "resumo do que foi mostrado",
    chamadaFinal: "comenta se voce ja passou por isso",
    formato: "fala_para_camera",
    porQueFuncionou: "mostra o produto agindo direto na mancha, sem cortar",
  };

  for (const [indice, contaId] of [contaA.id, contaB.id, contaA.id].entries()) {
    const idExterno = `captura-v5b-prova-${indice}`;
    const existente = await db().select().from(videos).where(eq(videos.idExterno, idExterno));
    if (existente.length > 0) continue;

    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno,
        url: `https://exemplo.invalido/${idExterno}`,
        nichoId: cliente.nichoId,
        contaId,
        titulo: TEMA_COM_PROVA,
        foraDaCurva: "4.1",
        publicadoEm: new Date(),
        idioma: "pt",
        analise: analise as never,
      });
  }
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v5b-tema-livre -- <nome-da-etapa> (ex.: "pr-50")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  await garantirVideosDeProva();

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function capturar(page: Page, estado: string, rotulo: string, modo: string): Promise<void> {
    const nomeArquivo = `TemaLivre.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  try {
    // proposta: campo vazio, a tela inicial.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje/tema-livre`);
        await page.waitForLoadState("networkidle");
        await capturar(page, "Proposta", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // esperando: atrasa a resposta de proposito, so para a foto.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje/tema-livre`);
        await page.waitForLoadState("networkidle");

        const controle: { liberar: (() => void) | null } = { liberar: null };
        await page.route("**/hoje/tema-livre", async (route) => {
          if (route.request().method() === "POST") {
            await new Promise<void>((resolve) => {
              controle.liberar = resolve;
            });
          }
          await route.continue();
        });

        await page.getByLabel("Sobre o que você quer falar?").fill(TEMA_SEM_PROVA);
        await page.getByRole("button", { name: "Avaliar o tema" }).click();
        try {
          await page.getByText("Costuma levar menos de 10 segundos.").waitFor({ state: "visible", timeout: 5000 });
          await capturar(page, "Esperando", tamanho.rotulo, modo.rotulo);
        } finally {
          controle.liberar?.();
        }
        await page.waitForLoadState("networkidle");
        await contexto.close();
      }
    }

    // naMeta: MARCADOR_NOTA_ALTA forca todos os pilares acima de 9 (src/ia/mock.ts).
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje/tema-livre`);
        await page.waitForLoadState("networkidle");
        await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA_ALTA);
        await page.getByRole("button", { name: "Avaliar o tema" }).click();
        await page.getByText("Editar o texto").waitFor({ state: "visible", timeout: 20000 });
        await capturar(page, "NaMeta", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // abaixoDaMeta: com prova suficiente, o cartao do angulo sugerido aparece.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje/tema-livre`);
        await page.waitForLoadState("networkidle");
        await page.getByLabel("Sobre o que você quer falar?").fill(TEMA_COM_PROVA);
        await page.getByRole("button", { name: "Avaliar o tema" }).click();
        await page.getByText("Editar o texto").waitFor({ state: "visible", timeout: 20000 });
        await capturar(page, "AbaixoDaMeta", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // erro: intercepta a Server Action para devolver falha.
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje/tema-livre`);
        await page.waitForLoadState("networkidle");

        await page.route("**/hoje/tema-livre", async (route) => {
          if (route.request().method() === "POST") {
            await route.fulfill({ status: 500, body: "erro simulado" });
            return;
          }
          await route.continue();
        });
        await page.getByLabel("Sobre o que você quer falar?").fill("um assunto que vai falhar na captura");
        await page.getByRole("button", { name: "Avaliar o tema" }).click();
        await page.getByText("Não deu para avaliar o tema").waitFor({ state: "visible", timeout: 10000 });
        await capturar(page, "Erro", tamanho.rotulo, modo.rotulo);
        await contexto.close();
      }
    }

    // Teclado aberto: viewport reduzida a 390x500 (item 1 do PROXIMO.md), o botao ainda visivel.
    {
      const contexto = await browser.newContext({ viewport: { width: 390, height: 500 }, colorScheme: "light" });
      const page = await contexto.newPage();
      await entrar(page, baseUrl);
      await page.goto(`${baseUrl}/hoje/tema-livre`);
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Sobre o que você quer falar?").focus();
      // Playwright headless nao abre teclado virtual de verdade, entao o evento de resize do
      // visualViewport (o gatilho real do handler da tela) nunca dispara aqui; rola manualmente
      // ate o botao, so para a captura mostrar o que o handler garante num aparelho de verdade.
      await page.getByRole("button", { name: "Avaliar o tema" }).scrollIntoViewIfNeeded();
      const nomeArquivo = "TemaLivre.Teclado.390.Claro.png";
      await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
      arquivosGravados.push(
        path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)),
      );
      await contexto.close();
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
