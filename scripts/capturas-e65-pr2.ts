/**
 * Capturas da E65 PR 2 (a tela "Criar carrossel" e os modelos de slide finais), para a revisão visual: os estados escolher (com a caixa da autorização do paciente), gerando, pronto, trocarTexto, trocarFoto, erro e
 * limite, a 390 (celular) e 1280 (computador), no claro, e o pronto também no escuro; mais os 7 PNG do carrossel de exemplo saídos do render de verdade (1080 por 1350), o antes e depois de saúde e a capa de notícia.
 * A marca de exemplo é uma clínica odontológica (ramo de saúde, cor #0e5a6a, @clinica.exemplo) com o texto do exemplo "Dentista" do desenho.
 *
 * Pré-requisitos: um `next dev` na porta de `CAPTURAS_URL` com `AI_PROVIDER=mock` e `CARROSSEL_ATIVO=1`, no banco do `.env`; três fotos de exemplo em `CAPTURAS_FOTOS` (foto1.jpg a foto3.jpg).
 * Uso: `npx tsx scripts/capturas-e65-pr2.ts`. Grava em `CAPTURAS_PASTA` (padrão `entregaveis/design/capturas/e65-pr2/`).
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { pngDoCarrossel } from "../src/carrossel/entrega";
import { renderizarSlides } from "../src/carrossel/render";
import { LINHA_FIXA_ANTES_DEPOIS_SAUDE, SEM_FOTO, type SlideDoCarrossel } from "../src/config/carrossel";
import { db } from "../src/db";
import { account, briefings, carrosseis, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../src/db/schema";
import { enviarFoto } from "../src/servicos/carrossel";
import { salvarTema } from "../src/servicos/clientes";

const SENHA = "ExemploSenha123";
const ID = "e65-clinica";
const EMAIL = `${ID}@exemplo.teste`;
const TEMA = "O jeito certo de escovar os dentes, em 4 passos";
const PASTA_FOTOS = process.env.CAPTURAS_FOTOS ?? "";
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
      perfil: {
        fatos: { oQueVende: "tratamentos odontológicos", preco: "sob avaliação", clienteIdeal: "famílias do bairro", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "clínica odontológica de bairro",
        referencias: [],
      },
    });
  }
  const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, ID));
  return marca.id;
}

/** O carrossel do exemplo "Dentista" do desenho, com as fotos de exemplo e os campos finos. */
async function carrosselDeExemplo(clienteId: number): Promise<number> {
  await db().delete(carrosseis).where(and(eq(carrosseis.clienteId, clienteId), eq(carrosseis.tema, TEMA)));
  const slides: SlideDoCarrossel[] = [
    { tipo: "capa-foto", rotulo: "Passo a passo", titulo: "Você escova os dentes todo dia. Mas escova do jeito certo?", sub: "4 passos para fazer em casa, hoje à noite." },
    { tipo: "passo", titulo: "Incline a escova para a gengiva", texto: "Deixe as cerdas num ângulo de 45 graus, apontando para onde o dente encontra a gengiva. É ali que a placa se junta.", numero: 1, de: 4, fotoId: SEM_FOTO },
    { tipo: "passo", titulo: "Movimentos curtos, sem força", texto: "Vaivém curto, de um ou dois dentes por vez. Força demais machuca a gengiva e não limpa melhor.", numero: 2, de: 4, fotoId: SEM_FOTO },
    { tipo: "dado", titulo: "", valor: "2", unidade: "min", frase: "é o tempo de escovação recomendado, duas vezes por dia, com escova de cerdas macias.", fonte: "Associação Dentária Americana (ADA)", referencia: "Recomendação de escovação, consultada em 2026" },
    { tipo: "passo", titulo: "Passe por todas as faces", texto: "Por fora, por dentro e em cima, onde se mastiga. O lado de dentro dos dentes da frente é o mais esquecido.", numero: 3, de: 4, fotoId: SEM_FOTO },
    { tipo: "passo", titulo: "Termine pela língua", texto: "Escove de trás para a frente, com leveza. Depois cuspa a pasta, sem enxaguar demais.", numero: 4, de: 4 },
    { tipo: "chamada", titulo: "Quer saber se está escovando certo?", texto: "Na sua próxima consulta, traga a sua escova: a gente olha junto com você.", acoes: ["Salve para lembrar", "Mande para alguém"] },
  ];
  const [criado] = await db()
    .insert(carrosseis)
    .values({
      clienteId,
      origem: "tema",
      origemRef: { livre: true },
      tema: TEMA,
      quantidade: 7,
      cor: "#0e5a6a",
      avisos: [],
      slides,
      legenda: "Escovar todo dia não é o mesmo que escovar do jeito certo. Salve este post e confira os 4 passos hoje à noite.\n\nNa sua próxima consulta, traga a sua escova: a gente olha junto com você.",
      hashtags: ["#saudebucal", "#escovacao", "#dentista"],
    })
    .returning();
  const fotos = [];
  for (const nome of ["foto1.jpg", "foto2.jpg"]) {
    fotos.push(await enviarFoto(clienteId, criado.id, { tipoDeclarado: "image/jpeg", bytes: readFileSync(path.join(PASTA_FOTOS, nome)), autorizacaoDoPaciente: true }));
  }
  slides[0].fotoId = fotos[0].id;
  slides[5].fotoId = fotos[1].id;
  await db().update(carrosseis).set({ slides }).where(eq(carrosseis.id, criado.id));
  return criado.id;
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
  await page.waitForLoadState("networkidle");
}

async function preencherEscolher(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/criar/carrossel`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Ou escreva o seu assunto").fill(TEMA);
  await page.getByRole("button", { name: "Usar este tema" }).click();
}

async function main(): Promise<void> {
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3210";
  const pasta = process.env.CAPTURAS_PASTA ?? path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", "e65-pr2");
  await mkdir(pasta, { recursive: true });
  const clienteId = await prepararMarca();
  const carrosselId = await carrosselDeExemplo(clienteId);
  const gravados: string[] = [];

  // Os PNG de verdade, saídos do render
  const todos = await pngDoCarrossel(clienteId, carrosselId);
  for (const [i, png] of todos!.png.entries()) {
    await writeFile(path.join(pasta, `slide-${i + 1}.png`), png);
    gravados.push(`slide-${i + 1}.png`);
  }
  const foto = { id: 1, tipo: "image/jpeg", bytes: readFileSync(path.join(PASTA_FOTOS, "foto3.jpg")) };
  const noticia = await renderizarSlides({
    slides: [{ tipo: "noticia", titulo: "Frente fria deixa a casa mais úmida esta semana: o que fazer com o mofo", veiculo: "[exemplo] Jornal da Cidade", data: "24 nov. 2026" }],
    fotos: [foto],
    cor: "#0e5a6a",
    arroba: "@clinica.exemplo",
  });
  await writeFile(path.join(pasta, "noticia.png"), noticia.png[0]);
  const saude = await renderizarSlides({
    slides: [
      { tipo: "capa-texto", rotulo: "Dúvida comum", titulo: "Seu dente escureceu? Nem sempre é sujeira", sub: "O que pode ser, e o que a dentista olha antes de clarear." },
      { tipo: "item", rotulo: "Causa 1 de 3", titulo: "Café, chá e vinho no dia a dia", texto: "Essa mancha fica por fora, na superfície do dente. Na consulta, a dentista vê se a limpeza resolve antes de falar em clarear." },
      { tipo: "item", rotulo: "Causa 2 de 3", titulo: "Uma pancada, mesmo antiga", texto: "O dente que levou um golpe pode escurecer meses depois, por dentro. Esse caso pede avaliação, nunca clareamento caseiro." },
      { tipo: "antes-depois", titulo: "Um caso do nosso consultório", antes: "Antes: o dente escurecido por dentro.", depois: "Depois: o tratamento que o caso pedia.", rodape: LINHA_FIXA_ANTES_DEPOIS_SAUDE, fotoId: 1, fotoDepoisId: 2 },
      { tipo: "resumo", titulo: "Para guardar", linhas: ["Cor escura tem causas diferentes", "Só a avaliação diz qual é", "Clarear vem depois"] },
      { tipo: "chamada", titulo: "Quer saber a causa do seu caso?", texto: "Agende uma avaliação e traga as suas dúvidas.", acoes: ["Salve para lembrar", "Mande para alguém"], responsavel: "Responsável técnica: Dra. [nome] · CRO-[UF] [número]" },
    ],
    fotos: [
      { id: 1, tipo: "image/jpeg", bytes: readFileSync(path.join(PASTA_FOTOS, "foto1.jpg")) },
      { id: 2, tipo: "image/jpeg", bytes: readFileSync(path.join(PASTA_FOTOS, "foto2.jpg")) },
    ],
    cor: "#0e5a6a",
    arroba: "@clinica.exemplo",
  });
  const nomes = ["saude-1-capa", "saude-2-item-com-fundo", "saude-3-item-com-fundo", "saude-4-antes-depois", "saude-5-resumo-com-fundo", "saude-6-chamada-com-responsavel"];
  await Promise.all(saude.png.map((png, i) => writeFile(path.join(pasta, `${nomes[i]}.png`), png)));
  gravados.push("noticia.png", ...nomes.map((n) => `${n}.png`));

  const browser = await chromium.launch();
  try {
    const variantes = [
      { modo: "Claro", cs: "light" as const, estados: ["escolher", "gerando", "pronto", "trocarTexto", "trocarFoto", "erro", "limite"] },
      { modo: "Escuro", cs: "dark" as const, estados: ["pronto"] },
    ];
    for (const v of variantes) {
      await salvarTema(clienteId, v.cs === "dark" ? "escuro" : "claro");
      for (const t of TAMANHOS) {
        const contexto = await browser.newContext({ viewport: { width: t.largura, height: t.altura }, colorScheme: v.cs, timezoneId: "America/Sao_Paulo" });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        const salvar = async (estado: string, tela = true) => {
          const arquivo = `CriarCarrossel.${estado}.${t.rotulo}.${v.modo}.png`;
          // A conferência do desenho: nada passa da borda e todo alvo de toque tem 44 px ou mais (os campos do formulário e os botões visíveis).
          const problemas = await page.evaluate(() => {
            const fora = document.documentElement.scrollWidth > window.innerWidth + 1 ? ["rolagem horizontal da página"] : [];
            const pequenos = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=file]):not([type=checkbox])"))
              .filter((el) => el.offsetParent !== null && !el.closest("[aria-hidden=true]") && !(el.className + "").includes("escondido"))
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 43.5)
              .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
            return [...fora, ...pequenos];
          });
          if (problemas.length > 0) console.log(`ATENCAO ${arquivo}: ${problemas.join("; ")}`);
          await page.screenshot({ path: path.join(pasta, arquivo), fullPage: tela });
          gravados.push(arquivo);
        };
        // as fotos que a tela manda ao servidor não vão para o carrossel de exemplo
        await page.route(/\/api\/carrossel\/\d+\/fotos$/, (rota) => rota.fulfill({ json: { foto: { id: 1 } } }));

        if (v.estados.includes("escolher")) {
          await preencherEscolher(page, baseUrl);
          await page.getByLabel("Tenho a autorização por escrito do paciente").check();
          await page.locator('input[type="file"]').first().setInputFiles([1, 2, 3].map((n) => path.join(PASTA_FOTOS, `foto${n}.jpg`)));
          await page.waitForTimeout(400);
          await salvar("Escolher");
          // gerando: o servidor demora; a captura é feita no meio da espera
          let soltar: () => void = () => undefined;
          const espera = new Promise<void>((resolve) => (soltar = resolve));
          await page.route(/\/api\/carrossel$/, async (rota) => {
            if (rota.request().method() !== "POST") return rota.continue();
            await espera;
            await rota.fulfill({ json: { id: carrosselId } });
          });
          await page.getByRole("button", { name: "Criar o carrossel" }).click();
          await page.getByRole("heading", { name: "Montando o seu carrossel" }).waitFor();
          await salvar("Gerando");
          soltar();
        } else {
          await page.route(/\/api\/carrossel$/, (rota) => (rota.request().method() === "POST" ? rota.fulfill({ json: { id: carrosselId } }) : rota.continue()));
          await preencherEscolher(page, baseUrl);
          await page.getByRole("button", { name: "Criar o carrossel" }).click();
        }
        await page.getByRole("heading", { name: "O seu carrossel está pronto" }).waitFor({ timeout: 60_000 });
        await page.locator('button[aria-pressed] img').first().waitFor({ timeout: 60_000 });
        await page.waitForFunction(() => document.querySelectorAll("button[aria-pressed] img").length >= 7, undefined, { timeout: 60_000 });
        await page.waitForTimeout(500);
        await salvar("Pronto");

        if (v.estados.includes("trocarTexto")) {
          await page.getByRole("button", { name: "Slide 3 de 7" }).click();
          await page.getByRole("button", { name: "Trocar o texto" }).click();
          const dialogo = page.getByRole("dialog");
          await dialogo.getByLabel("Explicação").fill("O dente que levou um golpe escurece por dentro. Com o clareamento, ele volta ao branco em uma sessão.");
          await page.waitForTimeout(400);
          await salvar("TrocarTexto", false);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
          await page.getByRole("button", { name: "Slide 6 de 7" }).click();
          await page.getByRole("button", { name: "Trocar a foto" }).click();
          await page.waitForTimeout(600);
          await salvar("TrocarFoto", false);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }

        if (v.estados.includes("erro")) {
          await page.unroute(/\/api\/carrossel$/);
          await page.route(/\/api\/carrossel$/, (rota) => (rota.request().method() === "POST" ? rota.fulfill({ status: 500, json: { erro: "nao foi possivel criar o carrossel agora, tente de novo" } }) : rota.continue()));
          await preencherEscolher(page, baseUrl);
          await page.getByRole("button", { name: "Criar o carrossel" }).click();
          await page.getByRole("heading", { name: "O carrossel não ficou pronto" }).waitFor();
          await salvar("Erro", false);
          await page.unroute(/\/api\/carrossel$/);
          await page.route(/\/api\/carrossel$/, (rota) => (rota.request().method() === "POST" ? rota.fulfill({ status: 402, json: { erro: "O seu teste chegou ao fim: para continuar criando, escolha um plano." } }) : rota.continue()));
          await preencherEscolher(page, baseUrl);
          await page.getByRole("button", { name: "Criar o carrossel" }).click();
          await page.getByRole("heading", { name: "Não dá para criar mais carrosséis agora" }).waitFor();
          await salvar("Limite", false);
        }
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }
  await salvarTema(clienteId, "claro");
  console.log(`${gravados.length} capturas em ${pasta}:\n${gravados.join("\n")}`);
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
