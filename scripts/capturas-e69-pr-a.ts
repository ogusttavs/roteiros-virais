/**
 * Capturas da E69 PR A (a ilustracao por slide): um carrossel de 7 slides de odontologia com as imagens da maquete de 25/11/2026 (`ilustracoes-prova/g6`), renderizado a 1080 por 1350 no render de verdade
 * (com a ilustracao, o veu medido e a mistura dos dois estilos), a folha com os 7, e a tela pronta a 390x844 (precisa de um `next dev` em `CAPTURAS_URL` com `AI_PROVIDER=mock`, `CARROSSEL_ATIVO=1` e
 * `ILUSTRACAO_ATIVA=1`, no banco do `.env`). Uso: `ILUSTRACAO_ATIVA=1 CARROSSEL_ATIVO=1 npx tsx scripts/capturas-e69-pr-a.ts`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { pngDoCarrossel } from "../src/carrossel/entrega";
import type { SlideDoCarrossel } from "../src/config/carrossel";
import { db } from "../src/db";
import { account, briefings, carrosseis, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../src/db/schema";
import { guardarIlustracao } from "../src/servicos/ilustracoes-do-carrossel";

const SENHA = "ExemploSenha123";
const ID = "e69-pr-a";
const EMAIL = `${ID}@exemplo.teste`;
const IMAGENS = path.resolve("D:/10-MEU/produtos/roteiros-virais/entregaveis/design-v2/entrega/carrossel/ilustracoes-prova/g6");

const SLIDES: SlideDoCarrossel[] = [
  { tipo: "capa-foto", rotulo: "Clareamento", titulo: "Clareamento: o que é mito e o que é verdade", sub: "Antes de comprar gel de farmácia, veja o que muda o tom do dente." },
  { tipo: "item", rotulo: "Mito 1 de 3", titulo: "Bicarbonato e limão clareiam", texto: "Essas receitas raspam a superfície do dente e podem deixar o esmalte áspero. Aí o dente fica mais fácil de manchar depois." },
  { tipo: "item", rotulo: "Mito 2 de 3", titulo: "Pasta clareadora muda a cor", texto: "Ela ajuda a tirar mancha de superfície, de café ou de chá. A cor de dentro do dente continua a mesma." },
  { tipo: "passo", titulo: "Agende a avaliação antes de clarear", texto: "A gente olha cárie, gengiva e manchas. Daí dá para dizer qual clareamento serve para o seu caso.", numero: 1, de: 1 },
  { tipo: "item", rotulo: "Mito 3 de 3", titulo: "Resina e porcelana não clareiam", texto: "Restauração, faceta e coroa mantêm a cor que têm hoje. Se o dente ao redor clarear, pode ser preciso trocar essa peça depois." },
  { tipo: "resumo", titulo: "O que guardar", linhas: ["Receita caseira arranha o esmalte", "Pasta tira mancha, não muda a cor", "Resina e porcelana não clareiam", "Avaliação primeiro, clareamento depois"] },
  { tipo: "chamada", titulo: "Quer saber se o clareamento serve para você?", texto: "Mande uma mensagem aqui e a recepção marca sua avaliação. Vamos com calma, ninguém vai te julgar.", acoes: ["Salve para lembrar", "Mande para alguém"] },
];
/** Qual imagem da maquete vai em qual slide (g6-01 a g6-09). */
const ARQUIVOS = ["g6-01.png", "g6-02.png", "g6-03.png", "g6-07.png", "g6-06.png", "g6-08.png", "g6-09.png"];

async function prepararMarca(): Promise<number> {
  const [nichoExistente] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
  const nicho = nichoExistente ?? (await db().insert(nichos).values({ slug: "e69-odonto", nome: "Odontologia", termos: [], ramoCatalogo: "odontologia" }).returning())[0];
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

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const pasta = process.env.CAPTURAS_PASTA ?? path.resolve("D:/10-MEU/produtos/roteiros-virais/entregaveis/design/capturas/e69-pr-a");
  await mkdir(path.join(pasta, "slides"), { recursive: true });
  const clienteId = await prepararMarca();
  await db().delete(carrosseis).where(eq(carrosseis.clienteId, clienteId));
  const [carrossel] = await db()
    .insert(carrosseis)
    .values({ clienteId, origem: "tema", origemRef: { livre: true }, tema: "clareamento", quantidade: 7, cor: "#0e5a6a", avisos: [], slides: SLIDES, legenda: "Clareamento tem método. Avaliação primeiro.", hashtags: ["#clareamento", "#saudebucal", "#dentista"] })
    .returning();
  for (let i = 0; i < ARQUIVOS.length; i += 1) await guardarIlustracao(carrossel.id, i, { bytes: await readFile(path.join(IMAGENS, ARQUIVOS[i])), generica: i >= 5 });
  const r = await pngDoCarrossel(clienteId, carrossel.id);
  if (!r) throw new Error("sem render");
  r.slides.forEach((s, i) => console.log(`slide ${i + 1} ${SLIDES[i].tipo}`, JSON.stringify(s.imagem), s.precisaEncurtar ? "PRECISA ENCURTAR" : ""));
  for (let i = 0; i < r.png.length; i += 1) await writeFile(path.join(pasta, "slides", `slide-${i + 1}.png`), r.png[i]);

  const navegador = await chromium.launch();
  const folha = await navegador.newPage({ viewport: { width: 4 * 432 + 5 * 16, height: 2 * 540 + 3 * 16 } });
  await folha.setContent(
    `<body style="margin:0;background:#e8e8e4;display:grid;grid-template-columns:repeat(4,432px);gap:16px;padding:16px">${r.png.map((p) => `<img style="width:432px;height:540px" src="data:image/png;base64,${p.toString("base64")}">`).join("")}</body>`,
  );
  await folha.screenshot({ path: path.join(pasta, "folha-7-slides.png"), fullPage: true });

  const baseUrl = process.env.CAPTURAS_URL;
  if (baseUrl) {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    const page = await contexto.newPage();
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(st); }));
    await entrar(page, baseUrl);
    await page.goto(`${baseUrl}/criar/carrossel?id=${carrossel.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: /pronto/i }).first().waitFor();
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(pasta, "tela-pronta.390.png") });
    await page.getByRole("button", { name: /Slide 3 de 7/ }).click();
    const botao = page.getByTestId("trocar-pela-minha-foto");
    await botao.waitFor();
    console.log("botao", JSON.stringify(await botao.boundingBox()));
    await page.evaluate(() => { const b = document.querySelector('[data-testid="trocar-pela-minha-foto"]'); b?.scrollIntoView({ block: "center" }); });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(pasta, "tela-slide-com-botao.390.png") });
    await page.screenshot({ path: path.join(pasta, "tela-pronta-completa.390.png"), fullPage: true });
    await contexto.close();
  }
  await navegador.close();
  console.log("carrossel", carrossel.id);
  process.exit(0);
}
void main();
