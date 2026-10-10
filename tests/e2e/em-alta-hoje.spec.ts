/**
 * O cartão "Em alta hoje" no Hoje e no Planejar (E55 PR 2, parte a): o assunto que está em alta no Brasil trazido para o ramo da marca, o roteiro criado dentro do cartão (e não repetido em
 * "Reels de hoje"), o menu sem "Não vou gravar hoje", o arrasto que não começa, o assunto que sai da lista e o atrasado que não muda de dia.
 *
 * Mesmo cuidado dos outros specs de agenda: um ramo, uma marca e uma rodada de tendências por teste (a "lista de agora" é a rodada mais recente, então cada teste põe a sua por último), com
 * o id do usuário trazendo o número da tentativa (o retry do Playwright insere de novo). O que o teste gravou em `tendencias_brasil` sai no fim.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { like } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, temasDia, tendenciasBrasil, user, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { somarDiasISO } from "../../src/servicos/roteiro";

const SENHA = "ExemploSenha123";
const PREFIXO = "E2E em alta";
const TITULO_DO_TEMA = "O mofo que a frente fria traz para o armário, e como tirar hoje";

const CONTEUDO_MINIMO = {
  titulo: "Mofo no armário: o que fazer hoje",
  duracaoS: 30,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no armário",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

type Preparo = {
  assunto: string;
  /** O roteiro já criado do assunto: de hoje, ou de ontem (atrasado). */
  roteiro?: { data: "hoje" | "ontem"; formato?: "reels" | "story" };
  /** A rodada de agora tem o assunto? (`false` põe outro assunto na rodada mais recente.) */
  naLista?: boolean;
  trafego?: string | null;
};

/** Uma marca num ramo só dela, com o tema do momento do dia (dois temas: um comum e o do momento) e a rodada de tendências de agora. */
async function prepararMarca(opcoes: Preparo) {
  const sufixo = `${test.info().testId}-r${test.info().retry}`;
  const usuarioId = `e2e-em-alta-${sufixo}`;
  const [nicho] = await db().insert(nichos).values({ slug: `e2e-em-alta-${sufixo}`, nome: `${PREFIXO} ${sufixo}`, termos: [] }).returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Em alta", email: `${usuarioId}@exemplo.teste` });
  await db()
    .insert(account)
    .values({ id: `${usuarioId}-credential`, issuer: "local:credential", accountId: usuarioId, providerId: "credential", userId: usuarioId, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: "[teste] Em alta", nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({
    clienteId: marca.id,
    completo: true,
    notaGeral: "8.50",
    perfil: {
      fatos: { oQueVende: "lavagem de estofados", preco: "sofá de 3 lugares por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
      resumo: "lava estofados em domicílio",
      referencias: [],
    },
  });

  const assunto = `${PREFIXO} ${opcoes.assunto} ${sufixo}`;
  const chave = assunto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const doMomento = { chave, assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 8 };
  const temas: TemaDoDia[] = [
    { titulo: "Um tema comum do setor", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" },
    { titulo: TITULO_DO_TEMA, descricao: "Curto e fácil de gravar: 30 segundos, no celular, na frente do armário.", porQue: "p", evidencias: [], puxaPara: "alcance", doMomento },
  ];
  await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });

  const agora = Date.now();
  const naLista = opcoes.naLista !== false;
  await db()
    .insert(tendenciasBrasil)
    .values({
      coletadaEm: new Date(agora - 60_000),
      assunto: naLista ? assunto : `${PREFIXO} outro assunto ${sufixo}`,
      chave: naLista ? chave : `outro ${chave}`,
      termos: [naLista ? assunto : `${PREFIXO} outro assunto ${sufixo}`],
      fontes: [{ fonte: "google", titulo: assunto, url: null, trafego: opcoes.trafego === undefined ? "2000+" : opcoes.trafego, posicao: 1 }],
      posicao: 1,
      sensivel: false,
    });

  if (opcoes.roteiro) {
    await db()
      .insert(roteiros)
      .values({
        clienteId: marca.id,
        data: opcoes.roteiro.data === "hoje" ? hojeISO() : somarDiasISO(hojeISO(), -1),
        tema: TITULO_DO_TEMA,
        origem: "sugerido",
        objetivo: "alcance",
        formato: opcoes.roteiro.formato ?? "reels",
        conteudo: CONTEUDO_MINIMO,
        status: "gerado",
        temaDoMomento: { chave, assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString() },
      });
  }
  return { email: `${usuarioId}@exemplo.teste`, assunto };
}

test.afterAll(async () => {
  await db().delete(tendenciasBrasil).where(like(tendenciasBrasil.assunto, `${PREFIXO}%`));
});

test.describe("o cartão Em alta hoje", () => {
  test("Hoje mostra o assunto, de onde vem, o número do Google e o tema do ramo; Criar o roteiro leva ao Objetivo com o tema do momento", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria" });
    await entrar(page, email);

    await expect(page.getByRole("heading", { name: "Em alta hoje", level: 2 })).toBeVisible();
    const cartao = page.locator("[data-em-alta]");
    await expect(cartao).toHaveCount(1);
    await expect(cartao.getByRole("heading", { name: assunto, level: 3 })).toBeVisible();
    await expect(cartao).toContainText("Em alta no Brasil");
    await expect(cartao).toContainText("Para hoje");
    await expect(cartao).toContainText("Buscas do Google no Brasil");
    await expect(cartao).toContainText("em alta desde");
    await expect(cartao).toContainText("Mais de 2.000 buscas no Google hoje.");
    await expect(cartao).toContainText("No seu ramo");
    await expect(cartao.getByRole("heading", { name: TITULO_DO_TEMA, level: 4 })).toBeVisible();
    await expect(cartao).toContainText("Curto e fácil de gravar: 30 segundos, no celular, na frente do armário.");
    await expect(cartao).toContainText("Vale enquanto o assunto estiver em alta. Não muda de dia.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "o cartão criou rolagem para o lado").toBe(true);

    await cartao.getByRole("button", { name: "Criar o roteiro" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=\d+/);
  });

  test("sem o número do Google (o assunto só no YouTube), o cartão não inventa buscas", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Trailer", trafego: null });
    await entrar(page, email);
    const cartao = page.locator("[data-em-alta]");
    await expect(cartao).toBeVisible();
    await expect(cartao).not.toContainText("buscas no Google hoje");
  });

  test("com o roteiro criado, ele mora dentro do cartão (Abrir o roteiro, a gravar), não se repete em Reels de hoje, e o menu não tem Não vou gravar hoje", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje" } });
    await entrar(page, email);

    const cartao = page.locator("[data-em-alta]");
    await expect(cartao.getByRole("button", { name: "Abrir o roteiro" })).toBeVisible();
    await expect(cartao).toContainText("a gravar");
    // O título do roteiro (não o do tema) aparece só se o item estivesse também na lista de Reels: não está.
    await expect(page.getByRole("heading", { name: "Mofo no armário: o que fazer hoje" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir o roteiro" })).toHaveCount(1);

    await cartao.getByRole("button", { name: `Mais opções: ${TITULO_DO_TEMA}` }).click();
    await expect(page.getByRole("menuitem", { name: "Arquivar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Não gostei, quero outro" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Não vou gravar hoje" })).toHaveCount(0);
    await expect(page.getByText("Não muda de dia: o assunto do momento é para hoje. Se não der para gravar, arquive.")).toBeVisible();

    // Arquivar é a saída: o cartão não volta a oferecer o mesmo assunto no mesmo dia.
    await page.getByRole("menuitem", { name: "Arquivar" }).click();
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
  });

  test("com o roteiro criado e nenhum outro Reels, a coluna de Reels não diz Nada marcado logo abaixo do cartão", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje" } });
    await entrar(page, email);
    await expect(page.locator("[data-em-alta]")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Reels de hoje" })).toHaveCount(0);
    await expect(page.getByText("Nada marcado")).toHaveCount(0);
  });

  test("o roteiro do momento cujo assunto já saiu da lista cai em Reels de hoje, e o menu dele também não tem Não vou gravar hoje", async ({ page }) => {
    // A coleta do meio-dia troca o assunto: o cartão some, o roteiro que a pessoa já criou continua do momento e não muda de dia.
    const { email } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje" }, naLista: false });
    await entrar(page, email);
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);

    const item = page.getByRole("listitem").filter({ hasText: "Mofo no armário" }).or(page.getByRole("article").filter({ hasText: "Mofo no armário" })).first();
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: /^Mais opções/ }).click();
    await expect(page.getByRole("menuitem", { name: "Arquivar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Não vou gravar hoje" })).toHaveCount(0);
    await expect(page.getByText("Não muda de dia: o assunto do momento é para hoje. Se não der para gravar, arquive.")).toBeVisible();
  });

  test("um Story criado do tema do momento mora no cartão e não se repete na coluna de Stories", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje", formato: "story" } });
    await entrar(page, email);
    const cartao = page.locator("[data-em-alta]");
    await expect(cartao.getByRole("button", { name: "Abrir o roteiro" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir o roteiro" })).toHaveCount(1);
    await expect(page.getByText("Mofo no armário: o que fazer hoje")).toHaveCount(0);
  });

  test("o assunto que sai do que está em alta tira o cartão sozinho", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", naLista: false });
    await entrar(page, email);
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Em alta hoje", level: 2 })).toHaveCount(0);
  });

  test("o atrasado do tema do momento grava hoje ou arquiva, mas não tem Mudar o dia", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "ontem" }, naLista: false });
    await entrar(page, email);

    const atrasado = page.getByRole("article").filter({ hasText: "Mofo no armário: o que fazer hoje" });
    await expect(atrasado).toBeVisible();
    await expect(atrasado.getByRole("button", { name: "Arquivar" })).toBeVisible();
    await expect(atrasado.getByRole("button", { name: "Mudar o dia" })).toHaveCount(0);
  });

  test("no Planejar, a visão Dia tem o cartão; a Semana não deixa arrastar o item do momento nem oferece Não vou gravar hoje", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { email } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje" } });
    await entrar(page, email);

    await page.goto("/planejamento?visao=dia");
    await expect(page.locator("[data-em-alta]")).toHaveCount(1);

    await page.goto("/planejamento?visao=semana");
    const linha = page.getByRole("listitem").filter({ hasText: "Mofo no armário: o que fazer hoje" });
    await expect(linha).toBeVisible();
    await expect(linha).toHaveAttribute("draggable", "false");
    await linha.getByRole("button", { name: /^Mais opções/ }).click();
    await expect(page.getByRole("menuitem", { name: "Arquivar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Não vou gravar hoje" })).toHaveCount(0);
  });
});
