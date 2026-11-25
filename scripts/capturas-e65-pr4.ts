/**
 * Capturas da E65 PR 4 (consertos da revisão final do carrossel): o escolher com a lista "Os seus carrosséis", o pronto depois de recarregar a página (o carrossel abre pelo `?id=`) e o erro do zip na tela
 * (o carrossel continua ali), a 390 e 1280, no claro, numa marca de clínica odontológica (#0e5a6a, @clinica.exemplo).
 * Pré-requisito: um `next dev` em `CAPTURAS_URL` com `AI_PROVIDER=mock` e `CARROSSEL_ATIVO=1`, no banco do `.env`. Uso: `npx tsx scripts/capturas-e65-pr4.ts`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import type { SlideDoCarrossel } from "../src/config/carrossel";
import { db } from "../src/db";
import { account, briefings, carrosseis, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../src/db/schema";

const SENHA = "ExemploSenha123";
const ID = "e65-ajustes";
const EMAIL = `${ID}@exemplo.teste`;
const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];

async function prepararMarca(): Promise<number> {
  const [nichoExistente] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
  const nicho = nichoExistente ?? (await db().insert(nichos).values({ slug: "e65-odonto", nome: "Odontologia", termos: [], ramoCatalogo: "odontologia" }).returning())[0];
  const [jaTem] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
  if (!jaTem) {
    await db().insert(user).values({ id: ID, name: "Clínica Exemplo", email: EMAIL });
    await db().insert(account).values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: ID, nome: "Clínica Exemplo", nichoId: nicho.id, corMarca: "#0e5a6a", perfis: { instagram: "clinica.exemplo", tiktok: null, youtube: null } })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: { fatos: { oQueVende: "tratamentos odontológicos", preco: "sob avaliação", clienteIdeal: "famílias do bairro", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] }, resumo: "clínica odontológica de bairro", referencias: [] },
    });
  }
  const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, ID));
  return marca.id;
}

async function criarCarrosseis(clienteId: number): Promise<void> {
  await db().delete(carrosseis).where(eq(carrosseis.clienteId, clienteId));
  const mk = (tema: string, titulo: string): SlideDoCarrossel[] => [
    { tipo: "capa-texto", rotulo: "Passo a passo", titulo, sub: "Para fazer em casa, hoje à noite." },
    { tipo: "item", rotulo: "Dica 1 de 3", titulo: "Incline a escova para a gengiva", texto: "Deixe as cerdas num ângulo de 45 graus, apontando para onde o dente encontra a gengiva, que é onde a placa se junta." },
    { tipo: "item", rotulo: "Dica 2 de 3", titulo: "Movimentos curtos, sem força", texto: "Faça um vaivém curto, de um ou dois dentes por vez. Força demais machuca a gengiva e não limpa melhor." },
    { tipo: "item", rotulo: "Dica 3 de 3", titulo: "Termine pela língua", texto: "Escove de trás para a frente, com leveza, e depois cuspa a pasta sem enxaguar demais a boca." },
    { tipo: "chamada", titulo: "Quer saber se está certo?", texto: "Na próxima consulta, traga a sua escova: a gente olha junto com você.", acoes: ["Salve para lembrar", "Mande para alguém"] },
  ];
  const itens: [string, string, number][] = [
    ["Escovar os dentes do jeito certo", "3 dicas para escovar do jeito certo", 5],
    ["Quando voltar ao dentista", "Quando é hora de voltar ao dentista?", 5],
    ["Cuidados com o aparelho", "3 cuidados com o aparelho no dia a dia", 5],
  ];
  for (const [i, [tema, titulo, quantidade]] of itens.entries()) {
    await db().insert(carrosseis).values({
      clienteId, origem: "tema", origemRef: { livre: true }, tema, quantidade, cor: "#0e5a6a", avisos: [], slides: mk(tema, titulo),
      legenda: "Escovar todo dia não é o mesmo que escovar do jeito certo. Salve este post e confira hoje à noite.", hashtags: ["#saudebucal", "#escovacao"],
      criadoEm: new Date(Date.now() - (itens.length - i) * 86_400_000),
    });
  }
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3220";
  const pasta = process.env.CAPTURAS_PASTA ?? path.resolve(__dirname, "..", "..", "..", "..", "entregaveis", "design", "capturas", "e65-ajustes");
  await mkdir(pasta, { recursive: true });
  await criarCarrosseis(await prepararMarca());
  const navegador = await chromium.launch();
  for (const t of TAMANHOS) {
    const contexto = await navegador.newContext({ viewport: { width: t.largura, height: t.altura }, colorScheme: "light" });
    const page = await contexto.newPage();
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(st); }));
    await entrar(page, baseUrl);
    await page.goto(`${baseUrl}/criar/carrossel`);
    await page.getByRole("heading", { name: "Os seus carrosséis" }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(pasta, `Escolher-lista.${t.rotulo}.Claro.png`) });
    await page.getByRole("button", { name: /Escovar os dentes do jeito certo/ }).click();
    await page.waitForURL(/\?id=\d+/);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: /pronto/i }).first().waitFor();
    await page.waitForTimeout(2500);
    console.log(t.rotulo, "url depois de recarregar:", page.url());
    await page.screenshot({ path: path.join(pasta, `Pronto-depois-de-recarregar.${t.rotulo}.Claro.png`) });
    await page.route("**/api/carrossel/*/zip", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ erro: "falhou" }) }));
    await page.getByRole("button", { name: /Baixar/ }).click();
    await page.getByText(/Não deu para baixar/).waitFor();
    await page.getByText(/Não deu para baixar/).scrollIntoViewIfNeeded();
    console.log(t.rotulo, "url depois do erro do zip:", page.url());
    await page.screenshot({ path: path.join(pasta, `Erro-do-zip.${t.rotulo}.Claro.png`) });
    await contexto.close();
  }
  await navegador.close();
  process.exit(0);
}
void main();
