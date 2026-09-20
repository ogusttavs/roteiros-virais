/**
 * Fluxo critico da etapa 24, parte 1 (plano de execucao, criterio de
 * aceite): admin cria um nicho pela tela, o nicho aparece na lista e na
 * tela de detalhe, e passa a existir na lista de nichos ao criar um
 * cliente. Nome do nicho com prefixo proprio (tests/e2e/global-setup.ts):
 * cada arquivo de spec cria os proprios dados, sem derrubar o schema de
 * novo, entao o nome nao pode colidir com o de outro arquivo nem com o
 * seed (`dentistas`, `produtos-de-limpeza`).
 */
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { contas, nichos } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const NOME_NICHO = "[exemplo e2e] Nicho de teste";
const SLUG_NICHO = "exemplo-e2e-nicho-de-teste";
const EMAIL_CLIENTE = "cliente-nicho-e2e@exemplo.teste";
/** Formato de `gerarSenhaLegivel` (`src/lib/senha-legivel.ts`): substantivo-adjetivo-NN-substantivo. */
const PADRAO_SENHA_GERADA = /[a-zà-ÿ]+-[a-zà-ÿ]+-\d{2}-[a-zà-ÿ]+/;

test("admin cria nicho, o nicho aparece na lista e serve para criar um cliente", async ({ page, browser }) => {
  // Dois fluxos num teste so (criar nicho, depois criar cliente com ele), varias
  // navegacoes de pagina inteira: o padrao de 30s aperta (briefing.spec.ts tem o
  // mesmo ajuste para o fluxo mais longo daquela suite).
  test.setTimeout(60_000);

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/clientes/);

  await page.goto("/admin/nichos");
  await page.getByRole("button", { name: "novo nicho" }).click();
  const modalNovoNicho = page.getByRole("dialog", { name: "Novo nicho" });
  await modalNovoNicho.getByLabel("nome", { exact: true }).fill(NOME_NICHO);
  await modalNovoNicho.getByLabel("descrição curta").fill("[exemplo e2e] nicho criado pelo teste automatizado");
  await modalNovoNicho
    .getByLabel("termos de busca")
    .fill("termo um\ntermo dois\ntermo tres\ntermo quatro\ntermo cinco");
  await modalNovoNicho.getByRole("button", { name: "criar nicho" }).click();

  await expect(page.getByRole("link", { name: NOME_NICHO })).toBeVisible();

  await page.getByRole("link", { name: NOME_NICHO }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/nichos/${SLUG_NICHO}$`));
  await expect(page.getByRole("heading", { name: NOME_NICHO })).toBeVisible();
  await expect(page.getByText("termo um")).toBeVisible();

  // Bloco novo (E6 parte 3, item 7): nicho recem criado, sem conta nem video
  // ainda, mas as tres plataformas aparecem com "0 / 0".
  await expect(page.getByRole("heading", { name: "estoque por plataforma" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "youtube" })).toContainText("0 / 0");

  // Bloco novo (E6 parte 3, segunda rodada, item 5): conta vigiada do
  // instagram ganha coluna de origem; sem META_ATIVO no ambiente de e2e,
  // toda conta do instagram e "apify".
  const [nichoCriado] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, SLUG_NICHO));
  await db()
    .insert(contas)
    .values({ plataforma: "instagram", handle: "exemplo-e2e-conta-instagram", nichoId: nichoCriado.id, vigiada: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "lista de vigilância" })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "exemplo-e2e-conta-instagram" }),
  ).toContainText("apify");

  await page.goto("/admin/clientes");
  await page.getByRole("button", { name: "convidar cliente" }).click();
  const modalConvidar = page.getByRole("dialog", { name: "Convidar cliente" });
  await modalConvidar.getByLabel("nome", { exact: true }).fill("[exemplo e2e] Cliente do nicho novo");
  await modalConvidar.getByLabel("e-mail", { exact: true }).fill(EMAIL_CLIENTE);
  // getByLabel("nicho") nunca resolvia aqui (achado rodando de verdade, timeout sem
  // erro de ambiguidade): o unico combobox dentro do proprio dialog e mais direto.
  await modalConvidar.getByRole("combobox").selectOption({ label: NOME_NICHO });
  await modalConvidar.getByRole("button", { name: "convidar por e-mail" }).click();

  // O cliente novo entra com a senha gerada (V3, item 5; mesmo caminho de
  // entrar-e-convidar.spec.ts), nao mais por link magico.
  const folha = page.getByRole("dialog", { name: "Convite mandado" });
  await expect(folha).toBeVisible();
  await expect(folha).toContainText(EMAIL_CLIENTE);
  const textoFolha = await folha.innerText();
  const senha = textoFolha.match(PADRAO_SENHA_GERADA)?.[0];
  expect(senha, "senha gerada visivel na folha").toBeTruthy();
  await folha.getByRole("button", { name: "copiei, pode fechar" }).click();

  const contextoCliente = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  await paginaCliente.goto("/entrar");
  await paginaCliente.getByLabel("E-mail").fill(EMAIL_CLIENTE);
  await paginaCliente.getByLabel("Senha").fill(senha!);
  await paginaCliente.getByRole("button", { name: "entrar", exact: true }).click();

  await expect(paginaCliente).toHaveURL(/\/comecar/);
  await expect(paginaCliente.getByText("Antes de escrever, a gente precisa te conhecer")).toBeVisible();

  await contextoCliente.close();
});
