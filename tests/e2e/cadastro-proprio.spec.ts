/**
 * E63 PR 2: o cadastro sozinho, de ponta a ponta, pelas telas. Dois modos, o mesmo arquivo:
 *
 * - com a chave desligada (a suíte de sempre): `/criar-conta` mostra o cadastro fechado (o formulário de interessado), `/entrar` não oferece cadastro e a página de vendas fica como sempre
 *   (`quero-testar.spec.ts` prova o resto);
 * - com a chave ligada (`E2E_CADASTRO_ABERTO=1 npx playwright test cadastro-proprio`): página de vendas, "Começar o teste grátis", criar a conta (erro de cada campo, depois o
 *   sucesso), "Confirme o seu e-mail", o link de confirmar, "E-mail confirmado" e o briefing. O e-mail simulado do e2e só escreve o assunto no log, então o link é montado aqui: o
 *   código de uso único entra no banco com o mesmo hash que o servidor confere (a geração do link e do e-mail é provada em `tests/integracao/cadastro-proprio.test.ts`).
 */
import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { db } from "../../src/db";
import { cadastrosProprios, clientes, confirmacoesDeEmail, user } from "../../src/db/schema";

const ABERTO = process.env.E2E_CADASTRO_ABERTO === "1";
const PREFIXO = `cadastro-e2e-${Date.now()}`;

test.afterAll(async () => {
  const contas = await db().select({ id: user.id }).from(user).where(like(user.email, `${PREFIXO}%`));
  for (const { id } of contas) {
    const [cadastro] = await db().select({ clienteId: cadastrosProprios.clienteId }).from(cadastrosProprios).where(eq(cadastrosProprios.usuarioId, id));
    await db().delete(user).where(eq(user.id, id));
    if (cadastro) await db().delete(clientes).where(eq(clientes.id, cadastro.clienteId)).catch(() => undefined);
  }
});

test.describe("com a chave do cadastro desligada", () => {
  test.skip(ABERTO, "este bloco é o da suíte de sempre");

  test("/criar-conta mostra o formulário de interessado, e Entrar não oferece cadastro", async ({ page }) => {
    await page.goto("/criar-conta");
    await expect(page.getByRole("heading", { level: 1, name: "O teste começa por conversa" })).toBeVisible();
    await expect(page.getByLabel("Seu WhatsApp")).toBeVisible();
    await expect(page.getByRole("link", { name: "Já tenho conta, quero entrar" })).toHaveAttribute("href", "/entrar");

    await page.goto("/entrar");
    await expect(page.getByText("Ainda não tem conta?")).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Começar o teste grátis" })).toHaveCount(0);
  });
});

test.describe("com a chave do cadastro ligada", () => {
  test.skip(!ABERTO, "precisa de E2E_CADASTRO_ABERTO=1 (servidor com a chave ligada)");

  test("da página de vendas ao briefing: criar a conta, confirmar o e-mail e entrar no briefing", async ({ page }) => {
    const email = `${PREFIXO}@exemplo.teste`;

    // A página de vendas leva ao cadastro e o formulário de interessado continua embaixo.
    await page.goto("/");
    await expect(page.getByText("Gravou? A gente edita")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quero testar" })).toBeVisible();
    await page.getByRole("link", { name: "Começar o teste grátis" }).first().click();
    await page.waitForURL("**/criar-conta");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Crie a sua conta" })).toBeVisible();
    await expect(page.getByText("No teste, até 10 roteiros e 3 vídeos editados.").first()).toBeVisible();

    // Vazio: cada campo diz o que falta, e o contador de pontos vem antes do botão.
    await page.getByRole("button", { name: "Começar o teste grátis" }).click();
    await expect(page.getByText("Escreva o seu nome.")).toBeVisible();
    await expect(page.getByText("Escreva o nome do seu negócio, ou o do seu perfil.")).toBeVisible();
    await expect(page.getByText("Escreva o seu e-mail.")).toBeVisible();
    await expect(page.getByText("Escolha uma senha.")).toBeVisible();
    await expect(page.getByText("Marque a caixa para criar a conta.")).toBeVisible();
    await expect(page.getByText("Confira os 5 pontos marcados acima.")).toBeVisible();

    // Senha curta, e depois tudo certo.
    await page.getByLabel("Seu nome").fill("Ana Souza");
    await page.getByLabel("Nome do seu negócio").fill("Padaria da Ana");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill("curta");
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Começar o teste grátis" }).click();
    await expect(page.getByText("A senha precisa de pelo menos 8 caracteres.")).toBeVisible();
    await page.getByLabel("Senha", { exact: true }).fill("SenhaBoa12345");
    await page.getByRole("button", { name: "Começar o teste grátis" }).click();

    // "Confirme o seu e-mail", com o endereço, "Mandar de novo" e "Trocar o e-mail".
    await expect(page.getByRole("heading", { level: 1, name: "Confirme o seu e-mail" })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trocar o e-mail" })).toBeVisible();

    // O link vencido (código que não existe): a mesma tela, na face "Esse link já venceu".
    await page.goto("/api/cadastro/confirmar?codigo=codigo-que-nao-existe");
    await expect(page.getByRole("heading", { level: 1, name: "Esse link já venceu" })).toBeVisible();

    // O link bom: o código de uso único entra no banco como o servidor o guarda (só o hash).
    const [pessoa] = await db().select({ id: user.id }).from(user).where(eq(user.email, email));
    const codigo = `codigo-e2e-${PREFIXO}`;
    await db()
      .insert(confirmacoesDeEmail)
      .values({ usuarioId: pessoa.id, codigoHash: createHash("sha256").update(codigo).digest("hex"), expiraEm: new Date(Date.now() + 60 * 60 * 1000), criadoEm: new Date() });
    await page.goto(`/api/cadastro/confirmar?codigo=${codigo}`);
    await expect(page.getByRole("heading", { level: 1, name: "E-mail confirmado" })).toBeVisible();
    await expect(page.getByText("Depois do briefing, começam os seus 7 dias grátis.")).toBeVisible();

    await page.getByRole("link", { name: "Ir para o briefing" }).click();
    await page.waitForURL("**/comecar", { timeout: 60_000 });
  });
});
