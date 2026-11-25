/**
 * Capturas da E66 (a capa de notícia), para a revisão visual: o cartão da notícia com o botão novo (Notícias), "Escolher o título", "Pronto" a 390 (celular) e 1280 (computador), e os dois PNG da capa saídos do
 * render de verdade (1080 por 1350), com foto e sem foto. A marca de exemplo é uma clínica odontológica (ramo de saúde, cor #0e5a6a, @clinica.exemplo) e a notícia é de odontologia, de ontem.
 * A foto de exemplo é desenhada pelo próprio navegador (uma cena de consultório em formas), só para a captura: nunca foto de cliente.
 *
 * Pré-requisitos: um `next dev` na porta de `CAPTURAS_URL` com `AI_PROVIDER=mock` e `CARROSSEL_ATIVO=1`, no banco do `.env`.
 * Uso: `npx tsx scripts/capturas-e66.ts`. Grava em `CAPTURAS_PASTA` (padrão `entregaveis/design/capturas/e66/`).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { pngDoCarrossel } from "../src/carrossel/entrega";
import { db } from "../src/db";
import { account, briefings, carrosseis, clientes, membrosMarca, nichos, noticias, preferenciasUsuario, user } from "../src/db/schema";
import { criarCapa } from "../src/servicos/capa-noticia";
import { enviarFoto } from "../src/servicos/carrossel";

const SENHA = "ExemploSenha123";
const ID = "e66-clinica";
const EMAIL = `${ID}@exemplo.teste`;
const DIA = 24 * 60 * 60 * 1000;
const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];

const MANCHETES = [
  "Conselho publica regra nova para o clareamento feito em consultório",
  "Mais de 3 em cada 10 brasileiros adiam a ida ao dentista, mostra levantamento",
  "Escovas elétricas ganham selo de qualidade no Brasil",
  "Dentistas pedem atenção ao uso de enxaguante bucal por crianças",
  "Ministério amplia a rede de atendimento odontológico em 2026",
  "Pesquisa liga a saúde da gengiva ao cuidado com o coração",
  "Notícia antiga de odontologia que não vira capa",
];

async function prepararMarca(): Promise<{ clienteId: number; noticiaId: number }> {
  const [nichoExistente] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
  const nicho = nichoExistente ?? (await db().insert(nichos).values({ slug: "e66-odonto", nome: "Odontologia", termos: [], ramoCatalogo: "odontologia" }).returning())[0];
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
      perfil: {
        fatos: { oQueVende: "tratamentos odontológicos", preco: "sob avaliação", clienteIdeal: "famílias do bairro", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "clínica odontológica de bairro",
        referencias: [],
      },
    });
  }
  const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, ID));
  await db().delete(noticias).where(eq(noticias.nichoId, nicho.id));
  const agora = Date.now();
  const horas = [20, 3, 5, 7, 26, 30, 10 * 24];
  const linhas = await db()
    .insert(noticias)
    .values(
      MANCHETES.map((titulo, i) => ({
        nichoId: nicho.id,
        titulo,
        url: `https://exemplo.invalido/e66-${i}`,
        fonte: ["[exemplo] Jornal da Cidade", "[exemplo] Portal Saúde", "[exemplo] Folha Local"][i % 3],
        publicadoEm: new Date(agora - horas[i] * 60 * 60 * 1000),
        resumo: "Resumo de exemplo da notícia, escrito para a captura.",
        relevante: true,
      })),
    )
    .returning();
  await db().delete(carrosseis).where(eq(carrosseis.clienteId, marca.id));
  return { clienteId: marca.id, noticiaId: linhas[0].id };
}

/** Uma foto de exemplo (consultório em formas), desenhada pelo navegador. */
async function fotoDeExemplo(): Promise<Buffer> {
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1200, height: 800 } });
    await pagina.setContent(`<body style="margin:0;width:1200px;height:800px;background:linear-gradient(180deg,#cfe4ea 0%,#e9f1f3 55%,#bcd2d8 55%,#a9c3ca 100%);position:relative;overflow:hidden;font-family:sans-serif">
      <div style="position:absolute;left:90px;top:110px;width:300px;height:360px;background:#fff;border-radius:18px;box-shadow:0 12px 30px #0003"></div>
      <div style="position:absolute;left:130px;top:150px;width:220px;height:30px;background:#0e5a6a;border-radius:8px"></div>
      <div style="position:absolute;left:130px;top:200px;width:160px;height:16px;background:#cfe4ea;border-radius:8px"></div>
      <div style="position:absolute;left:130px;top:232px;width:190px;height:16px;background:#cfe4ea;border-radius:8px"></div>
      <div style="position:absolute;left:520px;top:300px;width:560px;height:260px;background:#f4f4f2;border-radius:130px 130px 40px 40px;box-shadow:0 18px 40px #0004"></div>
      <div style="position:absolute;left:600px;top:200px;width:120px;height:120px;background:#0e5a6a;border-radius:50%"></div>
      <div style="position:absolute;left:880px;top:120px;width:12px;height:200px;background:#6b7f86"></div>
      <div style="position:absolute;left:820px;top:90px;width:130px;height:60px;background:#ffffff;border-radius:30px;box-shadow:0 0 40px #fff"></div></body>`);
    return await pagina.screenshot({ type: "jpeg", quality: 85 });
  } finally {
    await navegador.close();
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
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3210";
  const pasta = process.env.CAPTURAS_PASTA ?? path.resolve(__dirname, "..", "..", "..", "..", "entregaveis", "design", "capturas", "e66");
  await mkdir(pasta, { recursive: true });
  const { clienteId, noticiaId } = await prepararMarca();
  const foto = await fotoDeExemplo();
  await writeFile(path.join(pasta, "foto-de-exemplo.jpg"), foto);

  // Os PNG de verdade, saídos do render: a capa sem foto (a cor cheia no lugar dela) e com foto
  const sem = await criarCapa(clienteId, { noticiaId, titulo: "O que a regra nova muda no seu clareamento" });
  await writeFile(path.join(pasta, "capa-sem-foto.png"), (await pngDoCarrossel(clienteId, sem.id))!.png[0]);
  const com = await criarCapa(clienteId, { noticiaId, titulo: "O que a regra nova muda no seu clareamento" });
  await enviarFoto(clienteId, com.id, { tipoDeclarado: "image/jpeg", bytes: foto, autorizacaoDoPaciente: true });
  await writeFile(path.join(pasta, "capa-com-foto.png"), (await pngDoCarrossel(clienteId, com.id))!.png[0]);
  await db().delete(carrosseis).where(eq(carrosseis.clienteId, clienteId));

  const navegador = await chromium.launch();
  try {
    for (const t of TAMANHOS) {
      const contexto = await navegador.newContext({ viewport: { width: t.largura, height: t.altura }, colorScheme: "light", timezoneId: "America/Sao_Paulo" });
      const page = await contexto.newPage();
      await page.addInitScript(() => {
        const estilo = document.createElement("style");
        estilo.textContent = "nextjs-portal { display: none !important; }";
        document.documentElement.appendChild(estilo);
      });
      await entrar(page, baseUrl);
      const tela = async (nome: string, inteira = false) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(pasta, `${nome}.${t.rotulo}.png`), fullPage: inteira });
      };

      // O cartão da notícia com o botão novo
      await page.goto(`${baseUrl}/noticias`);
      await page.waitForLoadState("networkidle");
      const botoes = await page.getByRole("link", { name: "Criar capa com esta notícia" }).count();
      console.log(`${t.rotulo}: ${botoes} botão(ões) "Criar capa" em Notícias (7 notícias, 1 de 10 dias sem botão)`);
      await page.getByRole("link", { name: "Criar capa com esta notícia" }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(pasta, `Noticias-botao.${t.rotulo}.png`) });

      // Escolher o título (os títulos chegam do mock) e a foto
      await page.goto(`${baseUrl}/criar/capa?noticia=${noticiaId}`);
      await page.getByRole("heading", { name: "Escolha o título da capa" }).waitFor({ timeout: 60_000 });
      await page.getByLabel("Tenho a autorização por escrito do paciente").check();
      await page.locator('input[type="file"]').first().setInputFiles(path.join(pasta, "foto-de-exemplo.jpg"));
      await page.waitForTimeout(500);
      await tela("CriarCapa.Escolher", true);

      // Pronto
      await page.getByRole("button", { name: "Criar a capa" }).click();
      await page.getByRole("heading", { name: "A sua capa está pronta" }).waitFor({ timeout: 60_000 });
      await page.locator('img[alt="A capa pronta"]').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(600);
      await tela("CriarCapa.Pronto", true);
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }
  console.log(`Capturas gravadas em ${pasta}`);
  process.exit(0);
}

void main();
