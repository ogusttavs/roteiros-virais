/**
 * A senha na mão da pessoa (E58), nos três caminhos, contra o app de verdade com o e-mail simulado (`MODO_E2E`: o texto cai no log do servidor, nada sai pelo Resend):
 * o primeiro acesso de quem entrou por convite, o "Trocar senha" da Conta e o "esqueci a senha" (cliente e admin, link de uso único, link vencido, resposta igual exista
 * ou não a conta). O e-mail simulado não chega ao teste; o link é lido da tabela `verification` do mesmo banco, que é onde o better-auth guarda o código.
 *
 * Cada teste cria a pessoa dele (sem mexer nas contas do seed, que outros arquivos usam) direto no banco, como `aceite-termos.spec.ts`.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, like } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, senhasProvisorias, user, verification } from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function criarPessoa(id: string, opcoes: { admin?: boolean; provisoria?: boolean } = {}) {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, id));
  const email = `${id}@exemplo.teste`;
  if (jaExiste) return email;

  await db()
    .insert(user)
    .values({ id, name: `[teste] ${id}`, email, role: opcoes.admin ? "admin" : "cliente" });
  await db()
    .insert(account)
    .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  if (opcoes.provisoria) await db().insert(senhasProvisorias).values({ usuarioId: id });

  if (!opcoes.admin) {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
    const [cliente] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
    await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
  }
  return email;
}

async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

async function outroAparelho(browser: Browser, email: string, senha: string) {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await entrar(pagina, email, senha);
  await expect(pagina).toHaveURL(/\/hoje/);
  return { contexto, pagina };
}

/** O endereço do link que o e-mail levaria, montado do código que o servidor guardou para esta pessoa. */
async function linkDaRedefinicao(usuarioId: string): Promise<string> {
  const linhas = await db().select().from(verification).where(like(verification.identifier, "reset-password:%"));
  const dela = linhas.filter((l) => l.value === usuarioId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  expect(dela, "o servidor devia ter guardado o código do link").toBeTruthy();
  const codigo = dela.identifier.replace("reset-password:", "");
  return `/api/auth/reset-password/${codigo}?callbackURL=${encodeURIComponent("/redefinir-senha")}`;
}

test.describe("primeiro acesso: trocar a senha provisória do convite", () => {
  test("o painel só abre depois de escolher a senha; a provisória deixa de entrar e o outro aparelho cai", async ({ page, browser }) => {
    const email = await criarPessoa("e2e-senha-primeiro", { provisoria: true });
    // A pessoa já tinha entrado antes em outro aparelho, com a provisória.
    const aparelho2 = await browser.newContext();
    const pagina2 = await aparelho2.newPage();
    await entrar(pagina2, email, SENHA);
    await expect(pagina2).toHaveURL(/\/trocar-senha/);

    await entrar(page, email, SENHA);
    await expect(page).toHaveURL(/\/trocar-senha/);
    await expect(page.getByRole("heading", { name: "Escolha a sua senha" })).toBeVisible();

    // Antes de escolher, nenhuma outra tela do painel abre: volta para cá.
    await page.goto("/hoje");
    await expect(page).toHaveURL(/\/trocar-senha/);
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/trocar-senha/);

    const nova = page.getByLabel("senha nova", { exact: true });
    const repetir = page.getByLabel("repita a senha nova");
    const salvar = page.getByRole("button", { name: "salvar a minha senha" });

    await nova.fill("curta");
    await repetir.fill("curta");
    await salvar.click();
    await expect(page.getByText("a senha precisa de pelo menos 8 caracteres")).toBeVisible();

    await nova.fill("senha-que-eu-escolhi-1");
    await repetir.fill("senha-diferente-2");
    await salvar.click();
    await expect(page.getByText("as duas senhas não são iguais")).toBeVisible();

    await nova.fill(SENHA);
    await repetir.fill(SENHA);
    await salvar.click();
    await expect(page.getByText("a senha nova precisa ser diferente da provisória")).toBeVisible();
    await expect(page).toHaveURL(/\/trocar-senha/);

    await nova.fill("senha-que-eu-escolhi-1");
    await repetir.fill("senha-que-eu-escolhi-1");
    await salvar.click();
    await expect(page).toHaveURL(/\/hoje/);
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
    expect(await db().select().from(senhasProvisorias).where(eq(senhasProvisorias.usuarioId, "e2e-senha-primeiro"))).toHaveLength(0);

    // Escolhida a senha, a tela do primeiro acesso não volta.
    await page.goto("/trocar-senha");
    await expect(page).toHaveURL(/\/hoje/);

    // O outro aparelho foi encerrado.
    await pagina2.goto("/hoje");
    await expect(pagina2).toHaveURL(/\/entrar/);
    await aparelho2.close();

    // A provisória não entra mais; a nova entra.
    const limpa = await browser.newContext();
    const paginaLimpa = await limpa.newPage();
    await entrar(paginaLimpa, email, SENHA);
    await expect(paginaLimpa.getByText("e-mail ou senha não conferem")).toBeVisible();
    await paginaLimpa.getByLabel("Senha").fill("senha-que-eu-escolhi-1");
    await paginaLimpa.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(paginaLimpa).toHaveURL(/\/hoje/);
    await limpa.close();
  });

  test("quem escolheu a própria senha não vê a tela do primeiro acesso", async ({ page }) => {
    const email = await criarPessoa("e2e-senha-sem-provisoria");
    await entrar(page, email, SENHA);
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/trocar-senha");
    await expect(page).toHaveURL(/\/hoje/);
  });
});

test.describe("Trocar senha na Conta", () => {
  test("pede a senha de agora, troca, derruba o outro aparelho e a nova passa a entrar", async ({ page, browser }) => {
    const email = await criarPessoa("e2e-senha-conta");
    const aparelho2 = await outroAparelho(browser, email, SENHA);

    await entrar(page, email, SENHA);
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/conta");
    const cartao = page.locator('[data-teste="trocar-senha"]');
    await expect(cartao.getByRole("heading", { name: "Senha" })).toBeVisible();
    await cartao.getByRole("button", { name: "trocar a senha" }).click();

    await cartao.getByLabel("senha de agora").fill("nao-e-esta-aqui-1");
    await cartao.getByLabel("senha nova", { exact: true }).fill("senha-nova-da-conta-1");
    await cartao.getByLabel("repita a senha nova").fill("senha-nova-da-conta-1");
    await cartao.getByRole("button", { name: "trocar a senha" }).click();
    await expect(cartao.getByText("a senha de agora não confere")).toBeVisible();

    await cartao.getByLabel("senha de agora").fill(SENHA);
    await cartao.getByLabel("senha nova", { exact: true }).fill("curta");
    await cartao.getByLabel("repita a senha nova").fill("curta");
    await cartao.getByRole("button", { name: "trocar a senha" }).click();
    await expect(cartao.getByText("a senha precisa de pelo menos 8 caracteres")).toBeVisible();

    await cartao.getByLabel("senha nova", { exact: true }).fill("senha-nova-da-conta-1");
    await cartao.getByLabel("repita a senha nova").fill("senha-nova-da-conta-1");
    await cartao.getByRole("button", { name: "trocar a senha" }).click();
    await expect(page.getByText("Senha trocada.")).toBeVisible();
    // O formulário fecha e esvazia; esta sessão continua aberta.
    await expect(cartao.getByLabel("senha de agora")).toHaveCount(0);
    await page.goto("/hoje");
    await expect(page).toHaveURL(/\/hoje/);

    await aparelho2.pagina.goto("/hoje");
    await expect(aparelho2.pagina).toHaveURL(/\/entrar/);
    await aparelho2.contexto.close();

    const limpa = await browser.newContext();
    const paginaLimpa = await limpa.newPage();
    await entrar(paginaLimpa, email, SENHA);
    await expect(paginaLimpa.getByText("e-mail ou senha não conferem")).toBeVisible();
    await paginaLimpa.getByLabel("Senha").fill("senha-nova-da-conta-1");
    await paginaLimpa.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(paginaLimpa).toHaveURL(/\/hoje/);
    await limpa.close();
  });
});

test.describe("esqueci a senha", () => {
  test("cliente: pede o link, a resposta é a mesma para quem não tem conta, o link troca a senha uma vez só", async ({ page, browser }) => {
    const email = await criarPessoa("e2e-senha-esqueci", { provisoria: true });
    // Um aparelho que já tinha entrado com a provisória (fica na tela do primeiro acesso); a redefinição o encerra.
    const aparelho2 = await browser.newContext();
    const pagina2 = await aparelho2.newPage();
    await entrar(pagina2, email, SENHA);
    await expect(pagina2).toHaveURL(/\/trocar-senha/);

    // Quem tem conta.
    await page.goto("/entrar");
    await page.getByRole("button", { name: "esqueci a senha" }).click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "mandar o link" }).click();
    const comConta = await page.getByRole("status").innerText();
    expect(comConta).toContain("Se " + email + " tiver uma conta");
    expect(comConta).toContain("30 minutos");

    // Quem não tem conta: a mesma frase (com o e-mail digitado), e nenhum código guardado para ele.
    const outra = await browser.newContext();
    const paginaOutra = await outra.newPage();
    await paginaOutra.goto("/entrar");
    await paginaOutra.getByRole("button", { name: "esqueci a senha" }).click();
    await paginaOutra.getByLabel("E-mail").fill("ninguem-tem-esta-conta@exemplo.teste");
    await paginaOutra.getByRole("button", { name: "mandar o link" }).click();
    const semConta = await paginaOutra.getByRole("status").innerText();
    expect(semConta.replace("ninguem-tem-esta-conta@exemplo.teste", "EMAIL")).toBe(comConta.replace(email, "EMAIL"));
    await outra.close();

    // O link do e-mail leva à tela de escolher a senha.
    const link = await linkDaRedefinicao("e2e-senha-esqueci");
    await page.goto(link);
    await expect(page).toHaveURL(/\/redefinir-senha\?token=/);
    await expect(page.getByRole("heading", { name: "Escolha uma senha nova" })).toBeVisible();

    await page.getByLabel("senha nova", { exact: true }).fill("senha-depois-do-esqueci");
    await page.getByLabel("repita a senha nova").fill("outra-coisa-aqui-123");
    await page.getByRole("button", { name: "salvar a senha nova" }).click();
    await expect(page.getByText("as duas senhas não são iguais")).toBeVisible();

    await page.getByLabel("repita a senha nova").fill("senha-depois-do-esqueci");
    await page.getByRole("button", { name: "salvar a senha nova" }).click();
    await expect(page.getByText("Senha trocada. Agora é só entrar com a nova.")).toBeVisible();
    expect(await db().select().from(senhasProvisorias).where(eq(senhasProvisorias.usuarioId, "e2e-senha-esqueci"))).toHaveLength(0);

    // O código foi gasto: o mesmo link não vale mais.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();

    // A senha antiga não entra; a nova entra e vai direto ao painel (sem a tela do primeiro acesso).
    await page.getByRole("link", { name: "pedir um link novo" }).click();
    await expect(page).toHaveURL(/\/entrar\?esqueci=1/);
    await entrar(page, email, SENHA);
    await expect(page.getByText("e-mail ou senha não conferem")).toBeVisible();
    await page.getByLabel("Senha").fill("senha-depois-do-esqueci");
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);

    await pagina2.goto("/hoje");
    await expect(pagina2).toHaveURL(/\/entrar/);
    await aparelho2.close();
  });

  test("link vencido (passou de 30 minutos) não abre a tela de escolher a senha", async ({ page }) => {
    const email = await criarPessoa("e2e-senha-vencido");
    await page.goto("/entrar");
    await page.getByRole("button", { name: "esqueci a senha" }).click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "mandar o link" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const link = await linkDaRedefinicao("e2e-senha-vencido");
    const codigo = link.match(/reset-password\/([^?]+)/)![1];
    await db()
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${codigo}`));

    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
    await expect(page.getByLabel("senha nova", { exact: true })).toHaveCount(0);
  });

  test("a tela sem código nenhum também diz que o link não vale", async ({ page }) => {
    await page.goto("/redefinir-senha");
    await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
  });

  test("admin: o mesmo caminho serve ao admin, que cai em /admin com a senha nova", async ({ page }) => {
    const email = await criarPessoa("e2e-senha-admin", { admin: true });
    await page.goto("/entrar");
    await page.getByRole("button", { name: "esqueci a senha" }).click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "mandar o link" }).click();
    await expect(page.getByRole("status")).toContainText("tiver uma conta");

    await page.goto(await linkDaRedefinicao("e2e-senha-admin"));
    await page.getByLabel("senha nova", { exact: true }).fill("senha-nova-do-admin-1");
    await page.getByLabel("repita a senha nova").fill("senha-nova-do-admin-1");
    await page.getByRole("button", { name: "salvar a senha nova" }).click();
    await expect(page.getByText("Senha trocada.")).toBeVisible();

    await page.getByRole("button", { name: "ir para entrar" }).click();
    await expect(page).toHaveURL(/\/entrar/);
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill("senha-nova-do-admin-1");
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });
});
