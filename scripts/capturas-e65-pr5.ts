/**
 * Capturas da E65 PR 5 (os achados da prova real): o pronto com o aviso do espaço para completar (trecho entre colchetes) e o escolher em marca de saúde com as duas áreas de foto (as suas fotos e as de paciente) a 390x844, no claro, numa marca de clínica odontológica (#0e5a6a, @clinica.exemplo).
 * Pré-requisito: um `next dev` em `CAPTURAS_URL` com `AI_PROVIDER=mock` e `CARROSSEL_ATIVO=1`, no banco do `.env`. Uso: `npx tsx scripts/capturas-e65-pr5.ts`.
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
const ID = "e65-prova-ajustes";
const EMAIL = `${ID}@exemplo.teste`;
const TAMANHOS = [{ rotulo: "390", largura: 390, altura: 844 }];

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

async function criarCarrossel(clienteId: number): Promise<void> {
  await db().delete(carrosseis).where(eq(carrosseis.clienteId, clienteId));
  const slides: SlideDoCarrossel[] = [
    { tipo: "capa-texto", rotulo: "Mau hálito", titulo: "2 causas do mau hálito", sub: "E o que fazer hoje à noite." },
    { tipo: "item", rotulo: "Causa 1 de 2", titulo: "Língua sem limpar", texto: "A placa que fica na língua é uma das maiores fontes de mau cheiro. Passe o limpador de trás para a frente, com leveza." },
    { tipo: "item", rotulo: "Causa 2 de 2", titulo: "Pouca água ao longo do dia", texto: "Boca seca deixa as bactérias à vontade. Beba água aos poucos e, se o problema não passa, agende pelo [telefone da clínica]." },
    { tipo: "chamada", titulo: "Quer saber a sua causa?", texto: "Venha conversar com a gente. Atendemos [confira os horários de atendimento].", acoes: ["Salve para lembrar", "Mande para alguém"] },
  ];
  await db().insert(carrosseis).values({
    clienteId, origem: "tema", origemRef: { livre: true }, tema: "mau hálito", quantidade: 4, cor: "#0e5a6a", avisos: [], slides,
    legenda: "Mau hálito tem causa, e quase sempre dá para resolver. Para agendar, ligue [telefone da clínica].", hashtags: ["#saudebucal", "#mauhalito"],
  });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje\//);
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3230";
  const pasta = process.env.CAPTURAS_PASTA ?? path.resolve(__dirname, "..", "..", "..", "..", "entregaveis", "design", "capturas", "e65-prova-ajustes");
  await mkdir(pasta, { recursive: true });
  const clienteId = await prepararMarca();
  await criarCarrossel(clienteId);
  const [{ id }] = await db().select({ id: carrosseis.id }).from(carrosseis).where(eq(carrosseis.clienteId, clienteId));
  const navegador = await chromium.launch();
  for (const t of TAMANHOS) {
    const contexto = await navegador.newContext({ viewport: { width: t.largura, height: t.altura }, colorScheme: "light" });
    const page = await contexto.newPage();
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(st); }));
    await entrar(page, baseUrl);
    await page.goto(`${baseUrl}/criar/carrossel`);
    await page.getByRole("heading", { name: "As suas fotos" }).waitFor();
    await page.getByRole("heading", { name: "As suas fotos" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(pasta, `Escolher-fotos-saude.${t.rotulo}.Claro.png`) });
    await page.locator("#t-fotos").screenshot({ path: path.join(pasta, `Escolher-fotos-saude-secao.${t.rotulo}.Claro.png`) });
    await page.goto(`${baseUrl}/criar/carrossel?id=${id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: /pronto/i }).first().waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(pasta, `Pronto-com-aviso.${t.rotulo}.Claro.png`) });
    await page.getByRole("button", { name: /Slide 3 de 4/ }).click();
    await page.getByRole("button", { name: "Copiar a legenda" }).click();
    await page.getByTestId("confirma-copiar").waitFor();
    await page.getByTestId("confirma-copiar").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(pasta, `Legenda-confirmar.${t.rotulo}.Claro.png`) });
    await page.screenshot({ path: path.join(pasta, `Pronto-completo.${t.rotulo}.Claro.png`), fullPage: true });
    await contexto.close();
  }
  await navegador.close();
  process.exit(0);
}
void main();
