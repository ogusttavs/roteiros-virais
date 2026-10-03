/**
 * Capturas do PR 2 da E45 ("Não achei o meu" e o ramo provisório): o aviso do ramo provisório no Começar e na Conta, a frase de Criar temas
 * para o ramo que ainda está sendo pesquisado, e o admin (a lista "Pedidos de ramo", o número ao lado de "Nichos", "encaixar em um que
 * existe" e "criar ramo"), em 390 e 1280, claro e escuro. Nenhum dado de cliente: as marcas são as do seed.
 *
 * O script grava de verdade na Conta (é o que mostra o aviso depois de salvar) e cria um pedido para a outra marca; ao fim de cada
 * combinação desfaz os dois (apaga os pedidos e devolve o setor, o texto do ramo e o "onde" de cada marca). O setor do ramo provisório
 * (Agro e campo) continua nascido no banco de desenvolvimento, como nasceria pela tela.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`,
 * `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e45-pr2.ts <nome-da-pasta>` (ex.: "pr-111").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes, nichos, pedidosDeRamo } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";
import { registrarPedidoDeRamo } from "../src/servicos/pedidos-de-ramo";

const SENHA_SEED = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
/** O Começar, com a marca que fica de propósito sem briefing completo. */
const USUARIO_COMECAR = "seed-cliente-dentistas";
/** A Conta e Criar temas, com a marca que já aceitou os termos e completou o briefing. */
const USUARIO_CONTA = "seed-cliente-limpeza";

const TEXTO_ABELHAS = "criação de abelhas";
const TEXTO_SEM_PARECIDO = "xyzw abcd";
const TEXTO_VELAS = "fabricação de velas artesanais";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

/** Esconde o portal do Next em desenvolvimento (selo "Issue"). */
async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

/** Espera as animações da página (a folha e o modal entram com uma): fotografar no meio delas pega tudo translúcido. */
async function esperarAnimacoes(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((animacao) => animacao.playState !== "running"));
}

/** Esconde o portal e tudo o que é fixo (as barras ficam por cima do recorte). */
async function limparTela(page: Page): Promise<void> {
  await esconderPortal(page);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
}

/** O elemento inteiro, recortado da página inteira (sem barras fixas por cima). */
async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
}

/** A janela, com o alvo perto do topo: a lista aberta cai por cima do que vem embaixo, e o recorte por elemento não a pegaria. */
async function fotografarJanela(page: Page, alvo: Locator, arquivo: string, comFixos = false): Promise<void> {
  if (comFixos) await esconderPortal(page);
  else await limparTela(page);
  await alvo.evaluate((el) => {
    const topo = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo(0, Math.max(0, topo));
  });
  await page.screenshot({ path: arquivo });
}

async function entrar(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e45-pr2.ts <nome-da-pasta> (ex.: "pr-111")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marcaComecar] = await marcasDoUsuario(USUARIO_COMECAR);
  const [marcaConta] = await marcasDoUsuario(USUARIO_CONTA);
  if (!marcaComecar || !marcaConta) {
    throw new Error('clientes de seed nao encontrados; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).');
  }
  const originais = [marcaComecar, marcaConta].map((m) => ({ id: m.id, nichoId: m.nichoId, ramoOutro: m.ramoOutro, alcance: m.alcance }));

  /** Devolve as duas marcas ao que o seed deixou e apaga os pedidos que o script criou. */
  async function desfazer(): Promise<void> {
    await db()
      .delete(pedidosDeRamo)
      .where(
        inArray(
          pedidosDeRamo.clienteId,
          originais.map((o) => o.id),
        ),
      );
    for (const o of originais) {
      // Trocar de ramo desliga o setor que ficou sem marca (é a regra); o seed volta com o setor ligado.
      if (o.nichoId) await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, o.nichoId));
      await db().update(clientes).set({ nichoId: o.nichoId, ramoOutro: o.ramoOutro, alcance: o.alcance }).where(eq(clientes.id, o.id));
    }
  }

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    await desfazer();
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const novoContexto = () => browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });

        // ---------------------------------------------------------------- Começar (nada é salvo)
        {
          const contexto = await novoContexto();
          const page = await contexto.newPage();
          await entrar(page, baseUrl, `${USUARIO_COMECAR}@exemplo.teste`);
          await db().update(clientes).set({ nichoId: null, ramoOutro: null, alcance: null }).where(eq(clientes.id, marcaComecar.id));
          await page.goto(`${baseUrl}/comecar`);
          await page.getByRole("button", { name: "Começar", exact: true }).click();
          const campo = page.getByRole("combobox", { name: "Ramo" });
          await campo.waitFor({ state: "visible" });
          const cartao = page.locator("form > div").first();

          await campo.fill(TEXTO_ABELHAS);
          await page.getByRole("option", { name: /Não achei o meu/ }).waitFor({ state: "visible" });
          const lista = nomeDe("Comecar", "RamoNaoAcheiNaLista");
          await fotografarJanela(page, campo, lista);
          gravados.push(lista);

          await page.getByRole("option", { name: /Não achei o meu/ }).click();
          await page.locator("[data-aviso-ramo-provisorio]").waitFor({ state: "visible" });
          const provisorio = nomeDe("Comecar", "RamoProvisorio");
          await fotografarElemento(page, cartao, provisorio);
          gravados.push(provisorio);

          await page.getByLabel("Qual é o seu ramo").fill(TEXTO_SEM_PARECIDO);
          await page.getByText("A gente vai conferir o seu ramo.").waitFor({ state: "visible" });
          const semParecido = nomeDe("Comecar", "RamoSemParecido");
          await fotografarElemento(page, cartao, semParecido);
          gravados.push(semParecido);
          await contexto.close();
        }

        // ---------------------------------------------------------------- Conta e Criar temas (a Conta grava de verdade)
        {
          const contexto = await novoContexto();
          const page = await contexto.newPage();
          await entrar(page, baseUrl, `${USUARIO_CONTA}@exemplo.teste`);
          await page.goto(`${baseUrl}/conta`);
          const campo = page.getByRole("combobox", { name: "ramo" });
          await campo.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");

          await campo.fill(TEXTO_ABELHAS);
          await page.getByRole("option", { name: /Não achei o meu/ }).waitFor({ state: "visible" });
          const lista = nomeDe("Conta", "RamoNaoAcheiNaLista");
          await fotografarJanela(page, campo, lista);
          gravados.push(lista);

          await page.getByRole("option", { name: /Não achei o meu/ }).click();
          await page.getByLabel("Qual é o seu ramo").waitFor({ state: "visible" });
          await page.getByRole("button", { name: "salvar", exact: true }).click();
          await page.getByText("Você está em Agro e campo enquanto a gente confere o seu ramo.").waitFor({ state: "visible" });
          await page.getByText("salvo").first().waitFor({ state: "visible" });
          const provisorio = nomeDe("Conta", "RamoProvisorio");
          await fotografarElemento(page, page.locator("form").first(), provisorio);
          gravados.push(provisorio);

          await page.goto(`${baseUrl}/criar/temas`);
          await page.getByText("O seu ramo ainda está sendo pesquisado").waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          const temas = nomeDe("CriarTemas", "RamoNovo");
          await fotografarElemento(page, page.locator("main").first(), temas);
          gravados.push(temas);
          await contexto.close();
        }

        // ---------------------------------------------------------------- Admin (a segunda marca ganha um pedido sem ramo parecido)
        {
          await registrarPedidoDeRamo(marcaComecar.id, TEXTO_VELAS);
          const contexto = await novoContexto();
          const page = await contexto.newPage();
          await entrar(page, baseUrl, EMAIL_ADMIN);
          await page.goto(`${baseUrl}/admin/nichos`);
          const secao = page.locator("section[aria-labelledby='pedidos-de-ramo-titulo']");
          await secao.waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");

          const lista = nomeDe("AdminNichos", "PedidosDeRamo");
          await fotografarElemento(page, secao, lista);
          gravados.push(lista);

          const topo = nomeDe("AdminNichos", "NumeroNaAba");
          await fotografarJanela(page, page.locator("header").first(), topo, true);
          gravados.push(topo);

          const primeira = page.locator("[data-pedido-de-ramo]").first();
          await primeira.getByRole("button", { name: "encaixar em um que existe" }).click();
          const busca = primeira.getByRole("combobox", { name: /^Encaixar/ });
          await busca.fill("agro");
          await page.getByRole("option").first().waitFor({ state: "visible" });
          const encaixar = nomeDe("AdminNichos", "Encaixar");
          await fotografarJanela(page, secao, encaixar);
          gravados.push(encaixar);
          // A lista aberta cobre os botões: o Esc fecha só a lista, e então o "cancelar" fica ao alcance.
          await busca.press("Escape");
          await primeira.getByRole("button", { name: "cancelar" }).click();

          await page.locator("[data-pedido-de-ramo]").nth(1).getByRole("button", { name: "criar ramo" }).click();
          const modal = page.getByRole("dialog", { name: "Criar ramo para o pedido" });
          await modal.waitFor({ state: "visible" });
          await esperarAnimacoes(page);
          const criar = nomeDe("AdminNichos", "CriarRamo");
          await esconderPortal(page);
          await page.screenshot({ path: criar });
          gravados.push(criar);
          await contexto.close();
        }

        await desfazer();
      }
    }
  } finally {
    await browser.close();
    await desfazer();
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
