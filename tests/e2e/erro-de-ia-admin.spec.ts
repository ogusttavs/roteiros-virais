/**
 * O erro da API da IA dito pelo nome, só ao admin (achado de 05/10/2026): o simulador recusa a geração do roteiro pela causa que o texto do momento pede (`[mock:erro-credito]`,
 * `[mock:erro-sobrecarga]`, `[mock:erro-chave]`); o admin lê a causa na folha, o cliente comum lê a frase genérica de sempre; e o Início do admin avisa da falta de crédito até uma geração dar
 * certo depois. Grava as duas marcas direto no banco. Seguro para a repetição automática do Playwright.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, configuracaoAdmin, geracoesIA, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";
import { CHAVES_DAS_FALHAS_DA_IA, chaveDaFalhaDaIA } from "../../src/ia/falha-da-ia";

const SENHA = "ExemploSenha123";
const ADMIN = "e2e-erro-ia-admin";
const COMUM = "e2e-erro-ia-comum";
const TAREFA_DO_TESTE = "e2e-erro-ia-geracao-boa";
const GENERICA = "Não conseguimos fazer isso agora. Tente de novo em um minuto.";

function email(id: string): string {
  return `${id}@exemplo.teste`;
}

async function criarPessoaComMarca(id: string, role: "admin" | "cliente"): Promise<void> {
  const [existe] = await db().select({ id: user.id }).from(user).where(eq(user.id, id));
  if (existe) return;
  const [nicho] = await db().insert(nichos).values({ slug: `${id}-nicho`, nome: `[teste] ${id}`, termos: [] }).returning();
  await db().insert(user).values({ id, name: `[teste] ${id}`, email: email(id), role });
  await db().insert(account).values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId: id, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "conserto de eletrodomésticos", preco: "revisão simples por R$ 90", clienteIdeal: "mora perto da oficina", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "conserta eletrodomésticos na oficina própria",
        referencias: [],
      },
    });
}

async function entrar(page: Page, id: string, destino: RegExp) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(id));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(destino);
}

/** Conta o momento (com o marcador que faz o simulador recusar) e pede o roteiro; devolve a folha para ler a frase de erro. */
async function pedirRoteiroComMarcador(page: Page, marcador: string) {
  await page.goto("/criar");
  await page.getByRole("button", { name: "Contar o momento" }).click();
  const folha = page.getByRole("dialog", { name: "Gravar agora" });
  await expect(folha).toBeVisible();
  await folha.getByRole("button", { name: "Que muita gente veja" }).click();
  await folha.getByLabel("Onde você está").fill("Na oficina, de manhã");
  await folha.getByLabel("O que está acontecendo").fill(`Estou desmontando uma lavadora ${marcador}`);
  await folha.getByLabel("O que dá para mostrar").fill("A peça gasta e o antes e depois do conserto");
  await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
  return folha;
}

test.describe("o erro da IA dito pelo nome", () => {
  test.beforeAll(async () => {
    await criarPessoaComMarca(ADMIN, "admin");
    await criarPessoaComMarca(COMUM, "cliente");
  });

  test.beforeEach(async () => {
    await db().delete(configuracaoAdmin).where(inArray(configuracaoAdmin.chave, CHAVES_DAS_FALHAS_DA_IA));
    // Só as linhas que este arquivo põe: as gerações das outras specs têm roteiro apontando para elas (chave estrangeira).
    await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, TAREFA_DO_TESTE));
  });

  test.use({ viewport: { width: 390, height: 844 } });

  test("o admin lê a causa de cada erro; o texto cru da API nunca aparece", async ({ page }) => {
    await entrar(page, ADMIN, /\/admin\/?$/);
    const casos: [string, string][] = [
      ["[mock:erro-credito]", "A API da IA está sem crédito. Recarregue em Plans & Billing da Anthropic."],
      ["[mock:erro-sobrecarga]", "A IA está sobrecarregada, tente em um minuto."],
      ["[mock:erro-chave]", "A chave da IA foi recusada."],
    ];
    for (const [marcador, frase] of casos) {
      const folha = await pedirRoteiroComMarcador(page, marcador);
      await expect(folha.getByText(frase, { exact: false })).toBeVisible({ timeout: 30_000 });
      await expect(folha.getByText(GENERICA)).toHaveCount(0);
      await expect(page.getByText(/credit balance|x-api-key|Overloaded/)).toHaveCount(0);
    }
  });

  test("o cliente comum lê a frase genérica de sempre, mesmo com a IA sem crédito", async ({ page }) => {
    await entrar(page, COMUM, /\/hoje/);
    const folha = await pedirRoteiroComMarcador(page, "[mock:erro-credito]");
    await expect(folha.getByText(GENERICA)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sem crédito|Plans & Billing/)).toHaveCount(0);
  });

  test("o Início do admin avisa da falta de crédito e o aviso some quando uma geração dá certo depois", async ({ browser }) => {
    // o cliente comum esbarra na falta de crédito: nada na tela dele diz isso, mas fica anotado
    const contextoComum = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const paginaComum = await contextoComum.newPage();
    await entrar(paginaComum, COMUM, /\/hoje/);
    await pedirRoteiroComMarcador(paginaComum, "[mock:erro-credito]");
    await expect.poll(async () => (await db().select().from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chaveDaFalhaDaIA("credito")))).length, { timeout: 30_000 }).toBe(1);
    await contextoComum.close();

    const contextoAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await contextoAdmin.newPage();
    await entrar(admin, ADMIN, /\/admin\/?$/);
    await expect(admin.getByText("A API da IA está sem crédito")).toBeVisible();
    await expect(admin.getByText(/nenhuma geração sai enquanto isso/)).toBeVisible();

    // uma geração que deu certo depois apaga o aviso
    await db().insert(geracoesIA).values({ tarefa: TAREFA_DO_TESTE, versaoPrompt: "1", modelo: "mock", entradas: {}, criadoEm: new Date(Date.now() + 5_000) });
    await admin.reload();
    await expect(admin.getByText("A API da IA está sem crédito")).toHaveCount(0);
    await contextoAdmin.close();
  });

  test("a sobrecarga da IA não vira aviso no Início do admin (passa sozinha)", async ({ page, browser }) => {
    await entrar(page, COMUM, /\/hoje/);
    const folha = await pedirRoteiroComMarcador(page, "[mock:erro-sobrecarga]");
    await expect(folha.getByText(GENERICA)).toBeVisible({ timeout: 30_000 });
    const contexto = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await contexto.newPage();
    await entrar(admin, ADMIN, /\/admin\/?$/);
    await expect(admin.getByText("A API da IA está sem crédito")).toHaveCount(0);
    await contexto.close();
  });
});
