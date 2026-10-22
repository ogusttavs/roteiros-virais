/**
 * Capturas da E58 (a senha na mão da pessoa): "esqueci a senha" em Entrar (o pedido e a resposta), a tela do link do e-mail (escolher a senha, link que não vale,
 * senha trocada), a tela do primeiro acesso de quem entrou por convite e o cartão "Senha" da Conta (fechado e aberto), em 390 e 1280, claro e escuro.
 * Nenhum dado de cliente: as pessoas são criadas aqui, com e-mail `.teste`, no banco apontado por `DATABASE_URL`.
 *
 * Pré-requisitos: `DATABASE_URL` apontando para um banco de DESENVOLVIMENTO ou de revisão (nunca `roteiros`), migrado e semeado (`npm run db:migrate`, `npm run db:seed`), e o app no ar em
 * `CAPTURAS_URL` com o e-mail simulado (`MODO_E2E=1`, como o `playwright.config.ts` sobe) e `AI_PROVIDER=mock`. O app de produção (`next start`) com `MODO_E2E=1` serve.
 *
 * Uso: `npx tsx scripts/capturas-e58.ts <pasta-de-saida>` (ex.: `C:/getorbita/produtos/roteiros-virais/entregaveis/design/capturas/e58`).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, senhasProvisorias, user, verification } from "../src/db/schema";

const BASE = process.env.CAPTURAS_URL ?? "http://localhost:3159";
const SENHA = "ExemploSenha123";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "claro", colorScheme: "light" as const },
  { rotulo: "escuro", colorScheme: "dark" as const },
];

async function criarPessoa(id: string, provisoria: boolean): Promise<string> {
  const email = `${id}@exemplo.teste`;
  const [existe] = await db().select({ id: user.id }).from(user).where(eq(user.id, id));
  if (existe) {
    if (provisoria) await db().insert(senhasProvisorias).values({ usuarioId: id }).onConflictDoNothing();
    return email;
  }
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  await db().insert(user).values({ id, name: "[exemplo] Capturas E58", email, role: "cliente" });
  await db()
    .insert(account)
    .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  const [cliente] = await db().insert(clientes).values({ usuarioId: id, nome: "[exemplo] Capturas E58", nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
  if (provisoria) await db().insert(senhasProvisorias).values({ usuarioId: id });
  return email;
}

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function fotografarPagina(page: Page, arquivo: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: arquivo, fullPage: true });
}

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  // A barra de baixo e o que mais e fixo ficam por cima do recorte do celular: esconde.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
  await alvo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await alvo.screenshot({ path: arquivo });
}

async function main(): Promise<void> {
  const saida = process.argv[2];
  if (!saida) {
    console.error("uso: npx tsx scripts/capturas-e58.ts <pasta-de-saida>");
    process.exitCode = 1;
    return;
  }
  await mkdir(saida, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const tamanho of TAMANHOS) {
      for (const modo of MODOS) {
        const sufixo = `${tamanho.rotulo}-${modo.rotulo}`;
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        const arq = (nome: string) => path.join(saida, `${nome}-${sufixo}.png`);

        // 1. Entrar: o ponto de partida (agora com "esqueci a senha"), o pedido e a resposta.
        await page.goto(`${BASE}/entrar`);
        await fotografarPagina(page, arq("1-entrar"));
        await page.getByRole("button", { name: "esqueci a senha" }).click();
        await page.getByLabel("E-mail").fill("maria@exemplo.teste");
        await fotografarPagina(page, arq("2-esqueci-pedido"));
        await page.getByRole("button", { name: "mandar o link" }).click();
        await page.getByRole("status").waitFor();
        await fotografarPagina(page, arq("3-esqueci-enviado"));

        // 2. O link do e-mail: o código vem da tabela do próprio banco (o e-mail é simulado).
        const emailReset = await criarPessoa(`cap-e58-reset-${sufixo}`, false);
        const pedido = await contexto.newPage();
        await pedido.goto(`${BASE}/entrar?esqueci=1`);
        await pedido.getByLabel("E-mail").fill(emailReset);
        await pedido.getByRole("button", { name: "mandar o link" }).click();
        await pedido.getByRole("status").waitFor();
        await pedido.close();
        const linhas = await db().select().from(verification).where(like(verification.identifier, "reset-password:%"));
        const dela = linhas.find((l) => l.value === `cap-e58-reset-${sufixo}`);
        if (!dela) throw new Error("o servidor não guardou o código do link");
        const codigo = dela.identifier.replace("reset-password:", "");
        const link = `${BASE}/api/auth/reset-password/${codigo}?callbackURL=${encodeURIComponent("/redefinir-senha")}`;
        await page.goto(link);
        await fotografarPagina(page, arq("4-redefinir"));
        await page.getByLabel("senha nova", { exact: true }).fill("senha-nova-1");
        await page.getByLabel("repita a senha nova").fill("senha-nova-2");
        await page.getByRole("button", { name: "salvar a senha nova" }).click();
        await page.getByText("as duas senhas não são iguais").waitFor();
        await fotografarPagina(page, arq("5-redefinir-erro"));
        await page.getByLabel("repita a senha nova").fill("senha-nova-1");
        await page.getByRole("button", { name: "salvar a senha nova" }).click();
        await page.getByText("Senha trocada.").waitFor();
        await fotografarPagina(page, arq("6-redefinir-feito"));
        await page.goto(link);
        await fotografarPagina(page, arq("7-link-nao-vale"));

        // 3. O primeiro acesso de quem entrou por convite.
        const emailPrimeiro = await criarPessoa(`cap-e58-primeiro-${sufixo}`, true);
        await entrar(page, emailPrimeiro);
        await page.waitForURL(/\/trocar-senha/);
        await fotografarPagina(page, arq("8-primeiro-acesso"));
        await page.getByLabel("senha nova", { exact: true }).fill("curta");
        await page.getByLabel("repita a senha nova").fill("curta");
        await page.getByRole("button", { name: "salvar a minha senha" }).click();
        await page.getByText("a senha precisa de pelo menos 8 caracteres").waitFor();
        await fotografarPagina(page, arq("9-primeiro-acesso-erro"));

        // 4. A Conta: o cartão "Senha", fechado e aberto.
        const emailConta = await criarPessoa(`cap-e58-conta-${sufixo}`, false);
        await contexto.clearCookies();
        await entrar(page, emailConta);
        await page.goto(`${BASE}/conta`);
        const cartao = page.locator('[data-teste="trocar-senha"]');
        await fotografarElemento(page, cartao, arq("10-conta-senha-fechado"));
        await cartao.getByRole("button", { name: "trocar a senha" }).click();
        await fotografarElemento(page, cartao, arq("11-conta-senha-aberto"));
        await cartao.getByLabel("senha de agora").fill("nao-e-esta-aqui");
        await cartao.getByLabel("senha nova", { exact: true }).fill("senha-nova-1");
        await cartao.getByLabel("repita a senha nova").fill("senha-nova-1");
        await cartao.getByRole("button", { name: "trocar a senha" }).click();
        await cartao.getByText("a senha de agora não confere").waitFor();
        await fotografarElemento(page, cartao, arq("12-conta-senha-erro"));

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await getPool().end();
  }
}

void main();
