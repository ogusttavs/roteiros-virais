/**
 * Capturas da E46 PR 2 (o "ver como"), a 390 e 1280, claro e escuro: a página da conta no admin com o botão por pessoa, a folha "Ver o painel como", o Hoje e a Conta da pessoa com a
 * faixa fixa, e o registro das entradas depois de sair. Nenhum dado de cliente: a conta é a do seed; o admin é criado só no banco de dev.
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` ou `npm run start` na porta de
 * `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e46-pr2.ts <nome-da-pasta>` (ex.: "pr-125").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { account, clientes, preferenciasUsuario, user } from "../src/db/schema";

const SENHA = "ExemploSenha123";
const SEED = "seed-cliente-limpeza@exemplo.teste";
const ADMIN_ID = "cap-admin-ver-como";
const ADMIN_EMAIL = "cap-admin-ver-como@exemplo.teste";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 390, altura: 844, celular: true },
  { largura: 1280, altura: 900, celular: false },
];

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e46-pr2.ts <nome-da-pasta> (ex.: "pr-125")');
    process.exitCode = 1;
    return;
  }
  const base = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pasta = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pasta, { recursive: true });

  // O admin só existe no banco de dev; a pessoa vista é a do seed (termos aceitos para o painel ficar normal).
  await db().delete(user).where(eq(user.id, ADMIN_ID));
  await db().insert(user).values({ id: ADMIN_ID, name: "Gustavo Admin", email: ADMIN_EMAIL, role: "admin", emailVerified: true });
  await db().insert(account).values({ id: `${ADMIN_ID}-c`, issuer: "local:credential", accountId: ADMIN_ID, providerId: "credential", userId: ADMIN_ID, password: await hashPassword(SENHA) });
  const [pessoa] = await db().select({ id: user.id, nome: user.name }).from(user).where(eq(user.email, SEED));
  await db().insert(preferenciasUsuario).values({ usuarioId: pessoa.id, aceitouTermosEm: new Date() }).onConflictDoNothing();
  const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, pessoa.id));

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tela of LARGURAS) {
        const ctx = await browser.newContext({ viewport: { width: tela.largura, height: tela.altura }, colorScheme: modo.colorScheme, isMobile: tela.celular, hasTouch: tela.celular });
        const page = await ctx.newPage();
        const foto = async (grupo: string, estado: string, inteira = true) => {
          const arquivo = path.join(pasta, `${grupo}.${estado}.${tela.largura}.${modo.rotulo}.png`);
          await page.screenshot({ path: arquivo, fullPage: inteira });
          gravados.push(arquivo);
        };

        await page.goto(`${base}/entrar`);
        await page.getByLabel("E-mail").fill(ADMIN_EMAIL);
        await page.getByLabel("Senha").fill(SENHA);
        await page.getByRole("button", { name: "entrar", exact: true }).click();
        await page.waitForURL(/\/admin/);

        // A página da conta no admin, com o botão "ver como" em cada pessoa, e a folha.
        await page.goto(`${base}/admin/clientes/${marca.id}`);
        await assentar(page);
        await foto("Admin", "Conta");
        await page.getByRole("button", { name: `Ver o painel como ${pessoa.nome}` }).first().click();
        await page.waitForTimeout(500);
        await foto("Admin", "Folha", false);
        await page.getByRole("button", { name: `Ver como ${pessoa.nome}` }).click();
        await page.waitForURL(/\/hoje/);

        // O painel da pessoa com a faixa: Hoje e Conta.
        await assentar(page);
        await foto("Painel", "Hoje", false);
        await page.goto(`${base}/conta`);
        await assentar(page);
        await foto("Painel", "Conta");

        // A saída, e o registro na página da conta.
        await page.getByRole("button", { name: "Sair do modo" }).click();
        await page.waitForURL(new RegExp(`/admin/clientes/${marca.id}$`));
        await assentar(page);
        await page.locator('[data-bloco="ver-como"]').scrollIntoViewIfNeeded();
        await foto("Admin", "Registro", false);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await getPool().end();
  }
  for (const arquivo of gravados) console.log(arquivo);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
