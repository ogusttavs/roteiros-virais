/**
 * E61 PR 1, "o foco da conta" (28/10/2026): no Briefing, o cartão "O foco da sua conta" faz a pergunta "Dentro do seu setor, sobre o que você fala e para quem?". A pessoa pede uma sugestão
 * (a IA, aqui em mock), confirma com "Está certo", corrige com as próprias palavras e tira o foco; o que ela confirma continua lá depois de recarregar a página. Roda no celular e no computador.
 *
 * Seguro para a repetição automática do Playwright: cada teste zera o foco da marca antes de começar. Roda contra o `AI_PROVIDER=mock` do servidor.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user, type PerfilCompilado } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const USUARIO = "e2e-foco-da-conta";
const EMAIL = `${USUARIO}@exemplo.teste`;

let marcaId = 0;

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "automação de atendimento com inteligência artificial",
    preco: "mentoria mensal",
    clienteIdeal: "dono de pequena empresa",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: ["a tela do computador"],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "ensina dono de empresa a automatizar o marketing com IA",
  referencias: [],
};

async function prepararMarca(): Promise<number> {
  const [existente] = await db().select().from(clientes).where(eq(clientes.usuarioId, USUARIO));
  if (existente) return existente.id;
  const [nicho] = await db().insert(nichos).values({ slug: "e2e-foco-da-conta", nome: "Empreendedorismo teste", termos: [], pisoViews: 0 }).returning();
  await db().insert(user).values({ id: USUARIO, name: "Marca Foco", email: EMAIL });
  await db()
    .insert(account)
    .values({ id: `${USUARIO}-credential`, issuer: "local:credential", accountId: USUARIO, providerId: "credential", userId: USUARIO, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: USUARIO, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: USUARIO, nome: "[teste] Foco", nichoId: nicho.id, tipo: "pessoa", persona: "conhecido", alcance: "brasil" }).returning();
  await db().insert(membrosMarca).values({ usuarioId: USUARIO, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: marca.id, completo: true, notaGeral: "8.50", perfil: PERFIL });
  return marca.id;
}

async function entrarEAbrirOBriefing(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
  await page.goto("/briefing");
  const cartao = page.getByRole("region", { name: "O foco da sua conta" });
  await expect(cartao).toBeVisible();
  return cartao;
}

test.beforeAll(async () => {
  marcaId = await prepararMarca();
});

test.beforeEach(async () => {
  await db().update(clientes).set({ foco: null, focoOrigem: null, focoConfirmadoEm: null }).where(eq(clientes.id, marcaId));
});

for (const [nome, largura, altura] of [
  ["celular", 390, 844],
  ["computador", 1280, 800],
] as const) {
  test(`${nome}: pedir a sugestão, confirmar, recarregar, corrigir e tirar o foco`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    const cartao = await entrarEAbrirOBriefing(page);

    await expect(cartao.getByText("Dentro do seu setor, sobre o que você fala e para quem?")).toBeVisible();
    await expect(cartao.getByText("Você ainda não disse o foco.")).toBeVisible();

    await cartao.getByRole("button", { name: "Sugerir um foco para mim" }).click();
    await expect(cartao.getByText("A gente sugere, a partir do seu briefing:")).toBeVisible();
    await expect(cartao.getByText("Empreendedorismo teste, para donos de pequena empresa")).toBeVisible();
    await expect(cartao.getByText("a sugestão não entra nos seus roteiros")).toBeVisible();

    // A sugestão sem resposta fica guardada, mas só como sugestão.
    await page.reload();
    await expect(cartao.getByText("A gente sugere, a partir do seu briefing:")).toBeVisible();

    await cartao.getByRole("button", { name: "Está certo" }).click();
    await expect(cartao.getByText("Confirmado por você")).toBeVisible();
    await page.reload();
    await expect(cartao.getByText("Confirmado por você")).toBeVisible();
    await expect(cartao.getByText("Empreendedorismo teste, para donos de pequena empresa")).toBeVisible();

    await cartao.getByRole("button", { name: "Corrigir" }).click();
    const campo = cartao.getByLabel("O foco da sua conta");
    await campo.fill("marketing e automação com IA, para donos de pequena empresa");
    await cartao.getByRole("button", { name: "Salvar o foco" }).click();
    await expect(cartao.getByText("Escrito por você")).toBeVisible();
    await expect(cartao.getByText("marketing e automação com IA, para donos de pequena empresa")).toBeVisible();

    // Sem rolagem para os lados no celular.
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra).toBeLessThanOrEqual(0);

    await cartao.getByRole("button", { name: "Tirar o foco" }).click();
    await expect(cartao.getByText("Você ainda não disse o foco.")).toBeVisible();
    const [conta] = await db().select().from(clientes).where(eq(clientes.id, marcaId));
    expect(conta.foco).toBeNull();
  });
}

test("escrever o foco do zero, sem pedir sugestão, e a frase curta demais é recusada", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cartao = await entrarEAbrirOBriefing(page);

  await cartao.getByRole("button", { name: "Escrever eu mesmo" }).click();
  await cartao.getByLabel("O foco da sua conta").fill("IA");
  await cartao.getByRole("button", { name: "Salvar o foco" }).click();
  await expect(cartao.getByRole("alert")).toContainText("Escreva um pouco mais");

  await cartao.getByLabel("O foco da sua conta").fill("receitas rápidas para quem trabalha o dia todo");
  await cartao.getByRole("button", { name: "Salvar o foco" }).click();
  await expect(cartao.getByText("Escrito por você")).toBeVisible();
  await expect(cartao.getByText("Os seus roteiros puxam para este assunto")).toBeVisible();
});
