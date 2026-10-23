/**
 * "Acompanhar um assunto" que sugere enquanto a pessoa digita (melhoria da E53, 23/10/2026): na folha dos assuntos das Notícias, o campo "Assunto" mostra o que está em alta no Brasil
 * quando está vazio, sugere os assuntos da nossa lista com as palavras prontas enquanto a pessoa digita (começo de palavra, sem acento, termo curto inteiro), preenche o assunto e as
 * palavras ao escolher, e oferece "Sugerir palavras" (o modelo barato, aqui em mock) para o assunto que a lista não tem. A pessoa ainda edita as palavras antes de acrescentar.
 *
 * Seguro para a repetição automática do Playwright: cada teste limpa os assuntos da marca antes de começar; a rodada de tendências do teste sai no fim. Roda contra o `AI_PROVIDER=mock` do servidor.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, like } from "drizzle-orm";

import { db } from "../../src/db";
import { account, assuntosDaMarca, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, tendenciasBrasil, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const USUARIO = "e2e-assunto-sugere";
const EMAIL = `${USUARIO}@exemplo.teste`;
const PREFIXO = "E2E sugere";
const EM_ALTA = `${PREFIXO} Frente fria no Sul`;
const EM_ALTA_DELICADO = `${PREFIXO} Debate eleitoral de ontem`;

let marcaId = 0;

async function prepararMarca(): Promise<number> {
  const [existente] = await db().select().from(clientes).where(eq(clientes.usuarioId, USUARIO));
  if (existente) return existente.id;
  const [nicho] = await db().insert(nichos).values({ slug: "e2e-assunto-sugere", nome: "[teste] Assunto sugere", termos: [], pisoViews: 0 }).returning();
  await db().insert(user).values({ id: USUARIO, name: "Marca Sugere", email: EMAIL });
  await db()
    .insert(account)
    .values({ id: `${USUARIO}-credential`, issuer: "local:credential", accountId: USUARIO, providerId: "credential", userId: USUARIO, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: USUARIO, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: USUARIO, nome: "[teste] Sugere", nichoId: nicho.id, tipo: "negocio", persona: "negocio", alcance: "brasil" }).returning();
  await db().insert(membrosMarca).values({ usuarioId: USUARIO, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: marca.id, completo: true, notaGeral: "8.50" });
  return marca.id;
}

/** A rodada de agora das tendências do Brasil, só com o que este teste precisa: um assunto comum (com as palavras da coleta) e um delicado, que a folha não oferece. */
async function porRodadaDeTendencias() {
  await limparTendencias();
  const rodadaEm = new Date(Date.now() - 60_000);
  await db()
    .insert(tendenciasBrasil)
    .values([
      { coletadaEm: rodadaEm, assunto: EM_ALTA_DELICADO, chave: EM_ALTA_DELICADO.toLowerCase(), termos: ["debate", "candidatos"], fontes: [], posicao: 1, sensivel: true },
      { coletadaEm: rodadaEm, assunto: EM_ALTA, chave: EM_ALTA.toLowerCase(), termos: ["frente fria", "onda de frio", "geada"], fontes: [], posicao: 2, sensivel: false },
    ]);
}

async function limparTendencias() {
  await db().delete(tendenciasBrasil).where(like(tendenciasBrasil.assunto, `${PREFIXO}%`));
}

async function entrarEAbrirAFolha(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
  await page.goto("/noticias");
  await page.getByRole("button", { name: "Acompanhar um assunto" }).click();
  const folha = page.getByRole("dialog", { name: "Os assuntos que você acompanha" });
  await expect(folha).toBeVisible();
  return folha;
}

test.beforeAll(async () => {
  marcaId = await prepararMarca();
});

test.beforeEach(async () => {
  await db().delete(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marcaId));
  await porRodadaDeTendencias();
});

test.afterAll(limparTendencias);

test("digitar, ver a sugestão com as palavras prontas, escolher e acrescentar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const folha = await entrarEAbrirAFolha(page);
  const campo = folha.getByRole("combobox", { name: "Assunto" });
  const palavras = folha.getByLabel("Palavras que ajudam a achar (opcional)");

  // Campo vazio e em foco: o que está em alta agora, sem o assunto delicado.
  await campo.click();
  const lista = folha.locator("[data-sugestoes-de-assunto]");
  await expect(lista).toBeVisible();
  await expect(lista.getByRole("option", { name: new RegExp(EM_ALTA) })).toBeVisible();
  await expect(lista).toContainText("Em alta agora no Brasil");
  await expect(lista).not.toContainText(EM_ALTA_DELICADO);

  // Digitando, sem acento e pelo começo da palavra, a nossa lista aparece com as palavras prontas.
  await campo.fill("eleic");
  const eleicoes = lista.getByRole("option", { name: /^Eleições/ });
  await expect(eleicoes).toBeVisible();
  await expect(eleicoes).toContainText("eleição, eleições, candidatos, urna");
  await expect(lista).not.toContainText("Em alta agora no Brasil");

  // O plural com acento acha o mesmo assunto; o Enter escolhe o primeiro.
  await campo.fill("eleições");
  await expect(lista.getByRole("option", { name: /^Eleições/ })).toBeVisible();
  await campo.press("Enter");
  await expect(campo).toHaveValue("Eleições");
  await expect(palavras).toHaveValue("eleição, eleições, candidatos, urna, pesquisa eleitoral");
  await expect(folha.locator("[data-nota-das-palavras]")).toContainText("Palavras prontas da nossa lista");
  await expect(lista).toBeHidden();
  // O assunto da lista já traz as palavras: não oferece "Sugerir palavras".
  await expect(folha.getByRole("button", { name: "Sugerir palavras" })).toHaveCount(0);

  // A pessoa ainda mexe nas palavras antes de acrescentar.
  await palavras.fill("eleição, candidatos, debate");
  await expect(folha.locator("[data-nota-das-palavras]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "a folha criou rolagem para o lado").toBe(true);

  await folha.getByRole("button", { name: "Acrescentar", exact: true }).click();
  await expect(folha.locator("[data-assunto]").filter({ hasText: "Eleições" })).toBeVisible();
  const [salvo] = await db().select().from(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marcaId));
  expect(salvo.texto).toBe("Eleições");
  expect(salvo.termos).toEqual(["eleição", "candidatos", "debate"]);
});

test("termo curto inteiro: 'ia' acha inteligência artificial, e uma letra sozinha não sugere nada", async ({ page }) => {
  const folha = await entrarEAbrirAFolha(page);
  const campo = folha.getByRole("combobox", { name: "Assunto" });
  const lista = folha.locator("[data-sugestoes-de-assunto]");

  await campo.fill("ia");
  await expect(lista.getByRole("option", { name: /^Inteligência artificial/ })).toBeVisible();
  await expect(lista.getByRole("option", { name: /^Instagram/ })).toHaveCount(0);

  await campo.fill("i");
  await expect(lista.getByRole("option")).toHaveCount(0);
});

test("assunto que a lista não tem: 'Sugerir palavras' preenche as palavras, a pessoa edita e acrescenta", async ({ page }) => {
  const folha = await entrarEAbrirAFolha(page);
  const campo = folha.getByRole("combobox", { name: "Assunto" });
  const palavras = folha.getByLabel("Palavras que ajudam a achar (opcional)");

  await campo.fill("Torneio de xadrez");
  await expect(folha.locator("[data-sugestoes-de-assunto]").getByText('Não achamos "Torneio de xadrez" na nossa lista.')).toBeVisible();
  await expect(folha.locator("[data-sugestoes-de-assunto]").getByRole("option")).toHaveCount(0);

  await folha.getByRole("button", { name: "Sugerir palavras" }).click();
  await expect(palavras).toHaveValue(/Torneio de xadrez, Torneio, xadrez/);
  await expect(folha.locator("[data-nota-das-palavras]")).toContainText("Palavras que a gente sugeriu");
  const sugeridas = (await palavras.inputValue()).split(",").map((p) => p.trim());
  expect(sugeridas.length).toBeGreaterThanOrEqual(3);
  expect(sugeridas.length).toBeLessThanOrEqual(6);

  // Aceitar ou editar: a pessoa troca por três palavras dela.
  await palavras.fill("xadrez, torneio de xadrez, enxadrista");
  await folha.getByRole("button", { name: "Acrescentar", exact: true }).click();
  await expect(folha.locator("[data-assunto]").filter({ hasText: "Torneio de xadrez" })).toBeVisible();
  const [salvo] = await db().select().from(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marcaId));
  expect(salvo.texto).toBe("Torneio de xadrez");
  expect(salvo.termos).toEqual(["xadrez", "torneio de xadrez", "enxadrista"]);
});

test("escolher um assunto em alta preenche o nome e as palavras que a coleta guardou", async ({ page }) => {
  const folha = await entrarEAbrirAFolha(page);
  const campo = folha.getByRole("combobox", { name: "Assunto" });
  const palavras = folha.getByLabel("Palavras que ajudam a achar (opcional)");

  await campo.click();
  await folha.getByRole("option", { name: new RegExp(EM_ALTA) }).click();
  await expect(campo).toHaveValue(EM_ALTA);
  await expect(palavras).toHaveValue(`${EM_ALTA}, frente fria, onda de frio, geada`);
  await expect(folha.locator("[data-nota-das-palavras]")).toContainText("Palavras do que está em alta");
});

test("o nome exato de um assunto da lista não oferece 'Sugerir palavras', e mexer no texto depois de escolher volta a oferecer", async ({ page }) => {
  const folha = await entrarEAbrirAFolha(page);
  const campo = folha.getByRole("combobox", { name: "Assunto" });

  await campo.fill("Black Friday");
  await expect(folha.getByRole("button", { name: "Sugerir palavras" })).toHaveCount(0);
  await campo.fill("Black Friday do meu bairro");
  await expect(folha.getByRole("button", { name: "Sugerir palavras" })).toBeVisible();
});
