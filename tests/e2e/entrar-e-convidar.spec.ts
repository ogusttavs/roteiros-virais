/**
 * Fluxo critico da etapa 3 (plano de execucao, criterio de aceite): admin do
 * seed entra, cria um cliente, o cliente entra e cai em /comecar.
 *
 * V3, item 5: "Convidar cliente" parou de mandar link magico como caminho
 * principal (continua tentando mandar um, best-effort, mas a tela nao
 * depende mais disso, `mandarConviteMagico` em `servicos/clientes.ts`); a
 * folha "Convite mandado" mostra uma senha gerada, e e essa senha que a
 * pessoa usa para entrar pela primeira vez.
 */
import { expect, test } from "@playwright/test";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const EMAIL_NOVO_CLIENTE = "cliente-e2e@exemplo.teste";
/** Formato de `gerarSenhaLegivel` (`src/lib/senha-legivel.ts`): substantivo-adjetivo-NN-substantivo. */
const PADRAO_SENHA_GERADA = /[a-zà-ÿ]+-[a-zà-ÿ]+-\d{2}-[a-zà-ÿ]+/;

// Seed uma vez so, no globalSetup (etapa 11, ajuste 3 da revisao da etapa 10); o pool do
// Postgres fecha uma vez so, no globalTeardown (playwright.config.ts): mais de um arquivo de
// e2e roda no mesmo worker e compartilha o pool. EMAIL_NOVO_CLIENTE ja e um identificador
// proprio deste arquivo, unico o bastante.

test("admin entra, cria cliente, cliente entra com a senha gerada e cai em /comecar", async ({
  page,
  browser,
}) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/clientes/);

  await page.getByRole("button", { name: "convidar cliente" }).click();
  await page.getByLabel("nome", { exact: true }).fill("[exemplo] Cliente e2e");
  await page.getByLabel("e-mail", { exact: true }).fill(EMAIL_NOVO_CLIENTE);
  await page.getByRole("button", { name: "convidar por e-mail" }).click();

  const folha = page.getByRole("dialog", { name: "Convite mandado" });
  await expect(folha).toBeVisible();
  await expect(folha).toContainText(EMAIL_NOVO_CLIENTE);
  const textoFolha = await folha.innerText();
  const senha = textoFolha.match(PADRAO_SENHA_GERADA)?.[0];
  expect(senha, "senha gerada visivel na folha").toBeTruthy();
  await folha.getByRole("button", { name: "copiei, pode fechar" }).click();

  const contextoCliente = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  await paginaCliente.goto("/entrar");
  await paginaCliente.getByLabel("E-mail").fill(EMAIL_NOVO_CLIENTE);
  await paginaCliente.getByLabel("Senha").fill(senha!);
  await paginaCliente.getByRole("button", { name: "entrar", exact: true }).click();

  await expect(paginaCliente).toHaveURL(/\/comecar/);
  await expect(paginaCliente.getByText("Antes de escrever, a gente precisa te conhecer")).toBeVisible();

  await contextoCliente.close();
});
