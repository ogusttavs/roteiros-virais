/**
 * Capturas da E46 PR 1 (o admin de contas: Início, lista de Contas e a página da conta em blocos), a 1024 e 1280 em claro e escuro, mais 390 só para provar que nada quebra.
 * Nenhum dado de cliente: as contas são as do seed e duas de captura criadas aqui (uma com a mesma pessoa nas duas, para a busca por pessoa).
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` ou `npm run start` na porta de
 * `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e46-pr1.ts <nome-da-pasta>` (ex.: "pr-120").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { account, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../src/db/schema";

const SENHA = "ExemploSenha123";
const ADMIN = "admin@exemplo.teste";
const SEED_USUARIO = "seed-cliente-limpeza";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 1024, altura: 768, so_prova: false },
  { largura: 1280, altura: 900, so_prova: false },
  { largura: 390, altura: 844, so_prova: true },
];

async function entrar(page: Page, base: string, email: string): Promise<void> {
  await page.goto(`${base}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function prepararBanco(): Promise<{ seedMarcaId: number }> {
  const [limpeza] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  const [seedMarca] = await db().select().from(clientes).where(eq(clientes.usuarioId, SEED_USUARIO));
  const [seedUsuario] = await db().select().from(user).where(eq(user.id, SEED_USUARIO));

  // Uma segunda pessoa, com acesso às duas contas, e uma conta de captura, para a busca por pessoa mostrar "entra em 2 contas".
  await db().delete(user).where(eq(user.id, "captura-pessoa"));
  await db().insert(user).values({ id: "captura-pessoa", name: "Paula Mendes", email: "paula@exemplo.teste" });
  await db().insert(account).values({ id: "captura-pessoa-c", issuer: "local:credential", accountId: "captura-pessoa", providerId: "credential", userId: "captura-pessoa", password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: "captura-pessoa", aceitouTermosEm: new Date() });
  const [outra] = await db().insert(clientes).values({ usuarioId: "captura-pessoa", nome: "[exemplo] Clinica Sorriso", nichoId: limpeza.id, alcance: "local", regiao: "Campinas e região", tipo: "negocio" }).returning();
  await db().insert(membrosMarca).values([
    { usuarioId: "captura-pessoa", clienteId: outra.id, papel: "dono" },
    { usuarioId: "captura-pessoa", clienteId: seedMarca.id, papel: "membro" },
  ]);
  void seedUsuario;
  void roteiros;
  return { seedMarcaId: seedMarca.id };
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e46-pr1.ts <nome-da-pasta> (ex.: "pr-120")');
    process.exitCode = 1;
    return;
  }
  const base = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pasta = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pasta, { recursive: true });
  const { seedMarcaId } = await prepararBanco();

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tela of LARGURAS) {
        const ctx = await browser.newContext({ viewport: { width: tela.largura, height: tela.altura }, colorScheme: modo.colorScheme });
        const page = await ctx.newPage();
        const foto = async (grupo: string, estado: string) => {
          const arquivo = path.join(pasta, `${grupo}.${estado}.${tela.largura}.${modo.rotulo}.png`);
          await page.screenshot({ path: arquivo, fullPage: true });
          gravados.push(arquivo);
        };
        await entrar(page, base, ADMIN);

        await page.goto(`${base}/admin`);
        await assentar(page);
        await foto("AdminInicio", "Normal");

        await page.goto(`${base}/admin/clientes`);
        await assentar(page);
        await foto("AdminContas", "Todas");
        await page.getByRole("button", { name: /Parou/ }).click();
        await foto("AdminContas", "FiltroParou");
        await page.getByRole("button", { name: /Todas/ }).click();
        await page.getByLabel("Buscar por conta ou pessoa").fill("paula");
        await foto("AdminContas", "BuscaPessoa");
        await page.getByLabel("Buscar por conta ou pessoa").fill("clinica estrela");
        await foto("AdminContas", "BuscaVazia");

        await page.goto(`${base}/admin/clientes/${seedMarcaId}`);
        await assentar(page);
        await foto("AdminConta", "Blocos");
        await page.getByRole("button", { name: "Trocar ramo" }).click();
        await page.getByRole("combobox").first().fill("pet");
        await page.getByRole("option").first().click();
        await foto("AdminConta", "TrocarRamo");
        await page.getByRole("button", { name: "Cancelar" }).first().click();
        await page.getByRole("button", { name: "Trocar tipo" }).click();
        await page.getByRole("radio", { name: "Pessoal" }).click();
        await foto("AdminConta", "TrocarTipo");
        await page.getByRole("button", { name: "Cancelar" }).first().click();
        await page.getByRole("button", { name: "Trocar público" }).click();
        await page.getByRole("radio", { name: "Uma cidade ou região" }).click();
        await foto("AdminConta", "TrocarPublico");
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
