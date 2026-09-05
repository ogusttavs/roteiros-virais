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

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const NOME_NICHO = "[exemplo e2e] Nicho de teste";
const SLUG_NICHO = "exemplo-e2e-nicho-de-teste";
const EMAIL_CLIENTE = "cliente-nicho-e2e@exemplo.teste";

test("admin cria nicho, o nicho aparece na lista e serve para criar um cliente", async ({ page }) => {
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

  await page.goto("/admin/clientes");
  await page.getByRole("button", { name: "convidar cliente" }).click();
  const modalConvidar = page.getByRole("dialog", { name: "Convidar cliente" });
  await modalConvidar.getByLabel("nome", { exact: true }).fill("[exemplo e2e] Cliente do nicho novo");
  await modalConvidar.getByLabel("e-mail", { exact: true }).fill(EMAIL_CLIENTE);
  // getByLabel("nicho") nunca resolvia aqui (achado rodando de verdade, timeout sem
  // erro de ambiguidade): o unico combobox dentro do proprio dialog e mais direto.
  await modalConvidar.getByRole("combobox").selectOption({ label: NOME_NICHO });
  await modalConvidar.getByRole("button", { name: "convidar por e-mail" }).click();

  await expect(page.getByRole("status")).toContainText(EMAIL_CLIENTE);
});
