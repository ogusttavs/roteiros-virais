/**
 * O roteiro para fora do painel (E26, passo 23 do Opus): o PDF, a imagem 9:16 para o celular e o menu que leva a eles, na tela do roteiro e no menu da agenda do Hoje. Grava marca, roteiros e
 * vídeo direto no banco; só os arquivos passam pelo navegador (o Chromium do próprio servidor gera o PDF e as imagens, como em produção). Seguro para a repetição automática do Playwright:
 * a primeira passada cria a marca, e os roteiros de cada teste levam o número da tentativa no título.
 */
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, videos, type ConteudoRoteiro } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-exportar@exemplo.teste";
const NOME_MARCA = "[teste] Exportar";

let clienteId = 0;
let outraMarcaId = 0;
let videoId = 0;

const FALA = "Mostre a peça com a mancha de volta e conte, com as suas palavras, o que você fez da primeira vez, sem cortar a gravação e sem esconder o erro, porque é aí que a pessoa se reconhece.";

function conteudo(titulo: string, extra: Partial<ConteudoRoteiro> = {}): ConteudoRoteiro {
  return {
    titulo,
    duracaoS: 40,
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto.",
    corpo: "Mostre a peça com a mancha de volta.\nExplique a ordem certa enquanto faz.",
    fechamento: "Mostre a peça limpa.",
    chamadaFinal: "Me manda uma mensagem que eu te digo qual produto usar.",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "na área de serviço",
    edicao: {
      textoNaTela: [{ quando: "0 a 2 s", onde: "no topo", oQue: "a mancha voltou?" }],
      ritmoDeCorte: "Um corte a cada 4 ou 5 segundos.",
      recursos: [],
      audio: null,
      referencia: null,
    },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    ...extra,
  };
}

async function criarRoteiro(titulo: string, extra: Partial<ConteudoRoteiro> = {}, valores: Partial<typeof roteiros.$inferInsert> = {}): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId, data: hojeISO(), tema: titulo, origem: "livre", objetivo: "conversao", conteudo: conteudo(titulo, extra), ...valores })
    .returning({ id: roteiros.id });
  return linha.id;
}

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Largura e altura de um PNG, lidas do cabeçalho (IHDR), sem biblioteca nova. */
function dimensoesDoPng(bytes: Buffer): { largura: number; altura: number } {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) };
}

test.describe("exportar o roteiro", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-exportar"));
    if (existente) {
      clienteId = existente.id;
    } else {
      const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
      await db().insert(user).values({ id: "e2e-exportar", name: NOME_MARCA, email: EMAIL });
      await db().insert(account).values({ id: "e2e-exportar-credential", issuer: "local:credential", accountId: "e2e-exportar", providerId: "credential", userId: "e2e-exportar", password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-exportar", nome: NOME_MARCA, nichoId: nicho.id }).returning();
      clienteId = cliente.id;
      await db().insert(membrosMarca).values({ usuarioId: "e2e-exportar", clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-exportar", aceitouTermosEm: new Date() });
      await db()
        .insert(briefings)
        .values({
          clienteId: cliente.id,
          completo: true,
          perfil: {
            fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
            resumo: "produtos de limpeza",
            referencias: [],
          },
        });
    }
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
    // Uma segunda marca, de outra pessoa, para provar que o roteiro dela não sai pelas rotas de quem pede.
    const [outraMarca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-exportar-outra"));
    if (outraMarca) {
      outraMarcaId = outraMarca.id;
    } else {
      await db().insert(user).values({ id: "e2e-exportar-outra", name: "[teste] Exportar Outra", email: "e2e-exportar-outra@exemplo.teste" });
      const [cliente] = await db().insert(clientes).values({ usuarioId: "e2e-exportar-outra", nome: "[teste] Exportar Outra", nichoId: nicho.id }).returning();
      outraMarcaId = cliente.id;
    }
    const [existenteVideo] = await db().select({ id: videos.id }).from(videos).where(eq(videos.idExterno, "e2e-exportar-video"));
    if (existenteVideo) {
      videoId = existenteVideo.id;
    } else {
      // O vídeo de referência mora num setor só dele: no setor da limpeza ele entraria na conta de "vídeos fora da curva" que `referencias.spec.ts` confere (dois, e este seria o terceiro).
      const [setorDoVideo] = await db().insert(nichos).values({ slug: "e2e-exportar-setor-do-video", nome: "[teste] Exportar, setor do vídeo" }).returning();
      const [video] = await db()
        .insert(videos)
        .values({ plataforma: "instagram", idExterno: "e2e-exportar-video", url: "https://www.instagram.com/reel/e2e-exportar/", nichoId: setorDoVideo.id, titulo: "mancha", foraDaCurva: "4.1", publicadoEm: new Date(), analise: { porQueFuncionou: "Mostrou o problema antes de explicar." } as never })
        .returning({ id: videos.id });
      videoId = video.id;
    }
  });

  test("o menu do roteiro leva ao PDF e à imagem, e cada um avisa quando fica pronto", async ({ page }) => {
    test.setTimeout(90_000);
    const id = await criarRoteiro("exportar do menu");
    await entrar(page);
    // No computador o navegador pode saber compartilhar arquivos (o Chrome e o Edge do Windows, o Safari do Mac) e a folha dele não tem "salvar o PNG": a imagem baixa, e a folha nunca abre.
    await page.addInitScript(() => {
      const w = window as unknown as { __compartilhou?: boolean };
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", {
        value: async () => {
          w.__compartilhou = true;
        },
        configurable: true,
      });
    });
    await page.goto(`/roteiros/${id}`);

    await page.getByRole("button", { name: "Mais opções" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Baixar em PDF" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Guardar como imagem no celular" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copiar o texto do roteiro" })).toBeVisible();

    const downloadDoPdf = page.waitForEvent("download");
    await menu.getByRole("menuitem", { name: "Baixar em PDF" }).click();
    expect((await downloadDoPdf).suggestedFilename()).toBe(`roteiro-${hojeISO()}.pdf`);
    // O toast do PDF pronto, com "Abrir" (o iPad não mostra o download caindo).
    const toast = page.getByRole("status").filter({ hasText: "PDF do roteiro pronto" });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", { name: "Abrir" })).toBeVisible();

    await page.getByRole("button", { name: "Mais opções" }).click();
    const downloadDaImagem = page.waitForEvent("download");
    await page.getByRole("menu").getByRole("menuitem", { name: "Guardar como imagem no celular" }).click();
    const imagem = await downloadDaImagem;
    expect(imagem.suggestedFilename()).toBe(`roteiro-${hojeISO()}.png`);
    const { largura, altura } = dimensoesDoPng(await readFile((await imagem.path())!));
    expect({ largura, altura }).toEqual({ largura: 1080, altura: 1920 });
    await expect(page.getByRole("status").filter({ hasText: "Imagem do roteiro pronta" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __compartilhou?: boolean }).__compartilhou)).toBeUndefined();
  });

  test("a chave 'No PDF e na imagem, com as marcas de fala' leva as marcas ao pedido do PDF e ao da imagem (E41 2c)", async ({ page }) => {
    test.setTimeout(120_000);
    const id = await criarRoteiro("exportar com marcas");
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    await page.getByRole("button", { name: "Mais opções" }).click();
    const menu = page.getByRole("menu");
    const chave = menu.getByRole("menuitemcheckbox", { name: "No PDF e na imagem, com as marcas de fala" });
    await expect(chave).toBeVisible();
    // Desligada por padrão: o pedido do PDF não leva as marcas.
    await expect(chave).toHaveAttribute("aria-checked", "false");
    const pedidoSem = page.waitForRequest((r) => r.url().includes(`/api/roteiros/${id}/pdf`));
    const downloadSem = page.waitForEvent("download");
    await menu.getByRole("menuitem", { name: "Baixar em PDF" }).click();
    expect((await pedidoSem).url()).not.toContain("marcas=1");
    await downloadSem;

    // Ligada, vale para o PDF e para a imagem (e a chave não fecha o menu).
    await page.getByRole("button", { name: "Mais opções" }).click();
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(menu).toBeVisible();
    const pedidoCom = page.waitForRequest((r) => r.url().includes(`/api/roteiros/${id}/pdf?marcas=1`));
    const downloadCom = page.waitForEvent("download");
    await menu.getByRole("menuitem", { name: "Baixar em PDF" }).click();
    await pedidoCom;
    const pdf = await readFile((await (await downloadCom).path())!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    await page.getByRole("button", { name: "Mais opções" }).click();
    const pedidoDaImagem = page.waitForRequest((r) => r.url().includes(`/api/roteiros/${id}/imagem?marcas=1`));
    const downloadDaImagem = page.waitForEvent("download");
    await page.getByRole("menu").getByRole("menuitem", { name: "Guardar como imagem no celular" }).click();
    await pedidoDaImagem;
    const imagem = await downloadDaImagem;
    const { largura, altura } = dimensoesDoPng(await readFile((await imagem.path())!));
    expect({ largura, altura }).toEqual({ largura: 1080, altura: 1920 });

    // As marcas existem no roteiro (escritas ao abrir ou na hora do pedido).
    const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
    expect(linha.marcas?.blocos.length).toBeGreaterThan(0);

    // A página de impressão recebe mesmo as marcas: a imagem com elas (a legenda no pé, a fala marcada) é outra imagem, e sem elas continua a de sempre.
    const sem = (await (await page.request.get(`/api/roteiros/${id}/imagem`)).json()) as { imagens: string[] };
    const com = (await (await page.request.get(`/api/roteiros/${id}/imagem?marcas=1`)).json()) as { imagens: string[] };
    expect(sem.imagens.length).toBeGreaterThan(0);
    expect(com.imagens.length).toBeGreaterThan(0);
    expect(com.imagens[0]).not.toBe(sem.imagens[0]);
    const semDeNovo = (await (await page.request.get(`/api/roteiros/${id}/imagem`)).json()) as { imagens: string[] };
    expect(semDeNovo.imagens[0]).toBe(sem.imagens[0]);
  });

  test("em Story a chave das marcas não aparece no menu", async ({ page }) => {
    const id = await criarRoteiro(
      "exportar story sem marcas",
      { gancho: "", corpo: "", fechamento: "", chamadaFinal: "", cartoes: [{ oQueFalar: "Olha esta mancha", oQueMostrar: "o banco", textoNaTela: "mancha", figurinha: "nenhuma" }] },
      { formato: "story" },
    );
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Baixar em PDF" })).toBeVisible();
    await expect(page.getByRole("menu").getByRole("menuitemcheckbox")).toHaveCount(0);
  });

  // A folha de compartilhar só vale em aparelho de toque (o celular e o tablet): `(pointer: coarse)`.
  test.describe("no aparelho de toque", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("com a folha de compartilhar do aparelho, a imagem vai por ela e não baixa", async ({ page }) => {
    test.setTimeout(90_000);
    const id = await criarRoteiro("exportar compartilhando");
    await entrar(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __compartilhado?: { nome: string; tipo: string }[] };
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", {
        value: async (dados: { files: File[] }) => {
          w.__compartilhado = dados.files.map((f) => ({ nome: f.name, tipo: f.type }));
        },
        configurable: true,
      });
    });
    await page.goto(`/roteiros/${id}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Guardar como imagem no celular" }).click();

    await expect.poll(() => page.evaluate(() => (window as unknown as { __compartilhado?: unknown }).__compartilhado)).toEqual([{ nome: `roteiro-${hojeISO()}.png`, tipo: "image/png" }]);
    // Quem compartilhou já viu a folha do aparelho: o toast de "pronta" é só do download.
    await expect(page.getByRole("status").filter({ hasText: "Imagem do roteiro pronta" })).toHaveCount(0);
  });

  test("o aparelho que só compartilha logo depois de um toque (o iPhone) recebe o aviso 'pronta' com 'Guardar', e o segundo toque abre a folha", async ({ page }) => {
    test.setTimeout(90_000);
    const id = await criarRoteiro("exportar com segundo toque");
    await entrar(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __chamadas?: number; __compartilhado?: string[] };
      w.__chamadas = 0;
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", {
        value: async (dados: { files: File[] }) => {
          w.__chamadas = (w.__chamadas ?? 0) + 1;
          // A primeira vez o toque já passou (a imagem demorou); a segunda, dentro do toque em "Guardar", abre.
          if (w.__chamadas === 1) throw new DOMException("sem toque", "NotAllowedError");
          w.__compartilhado = dados.files.map((f) => f.name);
        },
        configurable: true,
      });
    });
    await page.goto(`/roteiros/${id}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Guardar como imagem no celular" }).click();

    const toast = page.getByRole("status").filter({ hasText: "A imagem do roteiro está pronta" });
    await expect(toast).toBeVisible();
    // Nada baixou nem compartilhou ainda: o primeiro pedido foi recusado, e o aviso espera o toque.
    expect(await page.evaluate(() => (window as unknown as { __compartilhado?: string[] }).__compartilhado)).toBeUndefined();
    await toast.getByRole("button", { name: "Guardar" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __compartilhado?: string[] }).__compartilhado)).toEqual([`roteiro-${hojeISO()}.png`]);
    expect(await page.evaluate(() => (window as unknown as { __chamadas?: number }).__chamadas)).toBe(2);
  });

  });

  test("a imagem do roteiro longo vira dois quadros, o parágrafo enorme parte entre frases sem cortar nada, e o do Story (com as cenas) e o curto, um", async ({ page }) => {
    test.setTimeout(120_000);
    const curto = await criarRoteiro("imagem do curto");
    const longo = await criarRoteiro("Um roteiro comprido para ver a imagem partir em dois quadros", { duracaoS: 90, corpo: [FALA, FALA, FALA, FALA, FALA, FALA].join("\n") });
    // Um parágrafo só de uns 3.300 letras (mais do que cabe num quadro mesmo com a letra encolhida), mais seis cenas: antes o fim da fala sumia sem aviso.
    const enorme = await criarRoteiro("imagem do paragrafo enorme", {
      duracaoS: 120,
      corpo: Array.from({ length: 40 }, (_, i) => `${FALA.split(",")[0]}, passo ${i + 1}, e conte do seu jeito o que mudou.`).join(" "),
      cenas: Array.from({ length: 6 }, (_, i) => ({ momento: `${i * 10} s`, oQueFazer: `a peça ${i + 1} em primeiro plano, perto da câmera` })),
    });
    const story = await criarRoteiro(
      "imagem do story",
      {
        gancho: "",
        corpo: "",
        fechamento: "",
        chamadaFinal: "",
        cartoes: [{ oQueFalar: "Bom dia, hoje tem mancha teimosa.", oQueMostrar: "a peça manchada", textoNaTela: "mancha teimosa", figurinha: "nenhuma" }],
        cenas: [{ momento: "0 a 3 s", oQueFazer: "a peça manchada, em primeiro plano" }],
      },
      { formato: "story" },
    );
    await entrar(page);

    const pedir = async (id: number) => {
      const resposta = await page.request.get(`/api/roteiros/${id}/imagem`, { timeout: 60_000 });
      expect(resposta.status()).toBe(200);
      const corpo = (await resposta.json()) as { nome: string; imagens: string[]; cortados: number };
      // Nenhum quadro sai com texto cortado: o que não cabe parte em quadros novos, ou encolhe a letra.
      expect(corpo.cortados).toBe(0);
      return corpo;
    };
    const doCurto = await pedir(curto);
    expect(doCurto.nome).toBe(`roteiro-${hojeISO()}`);
    expect(doCurto.imagens).toHaveLength(1);
    expect(dimensoesDoPng(Buffer.from(doCurto.imagens[0], "base64"))).toEqual({ largura: 1080, altura: 1920 });

    const doLongo = await pedir(longo);
    expect(doLongo.imagens.length).toBe(2);
    for (const base64 of doLongo.imagens) expect(dimensoesDoPng(Buffer.from(base64, "base64"))).toEqual({ largura: 1080, altura: 1920 });

    const doEnorme = await pedir(enorme);
    expect(doEnorme.imagens.length).toBeGreaterThanOrEqual(2);
    expect(doEnorme.imagens.length).toBeLessThanOrEqual(8);

    expect((await pedir(story)).imagens).toHaveLength(1);
  });

  test("o PDF do roteiro longo passa de uma página, e o curto com referência cabe em uma", async ({ page }) => {
    test.setTimeout(120_000);
    const curto = await criarRoteiro("pdf do curto com referencia", { edicao: { ...conteudo("x").edicao, referencia: { videoId, segundo: 4, oQueOlhar: "o antes" } } }, { referenciaVideoId: videoId, objetivoDoVideo: "mostrar que o problema é a ordem" });
    const longo = await criarRoteiro("pdf do longo", { duracaoS: 180, corpo: Array.from({ length: 24 }, () => FALA).join("\n") });
    await entrar(page);

    const pdfDoCurto = await page.request.get(`/api/roteiros/${curto}/pdf`, { timeout: 60_000 });
    expect(pdfDoCurto.status()).toBe(200);
    expect(pdfDoCurto.headers()["content-type"]).toContain("application/pdf");
    const paginas = (bytes: Buffer) => (bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    expect(paginas(await pdfDoCurto.body())).toBe(1);

    const pdfDoLongo = await page.request.get(`/api/roteiros/${longo}/pdf`, { timeout: 60_000 });
    expect(paginas(await pdfDoLongo.body())).toBeGreaterThan(1);
  });

  test("sem sessão, nenhuma das duas rotas entrega arquivo; o roteiro de outra marca não existe para quem pede", async ({ page, request }) => {
    const id = await criarRoteiro("exportar sem sessao");
    for (const rota of ["pdf", "imagem"]) {
      const semSessao = await request.get(`/api/roteiros/${id}/${rota}`);
      expect(semSessao.headers()["content-type"] ?? "").not.toMatch(/application\/(pdf|json)/);
    }
    await entrar(page);
    // O roteiro de outra marca existe, mas não para quem pede: 404 nas duas rotas, nunca o arquivo.
    const [daOutra] = await db().insert(roteiros).values({ clienteId: outraMarcaId, data: hojeISO(), tema: "de outra marca", origem: "livre", objetivo: "conversao", conteudo: conteudo("de outra marca") }).returning({ id: roteiros.id });
    for (const rota of ["pdf", "imagem"]) {
      expect((await page.request.get(`/api/roteiros/${daOutra.id}/${rota}`)).status()).toBe(404);
    }
    // Um id que não é o de roteiro nenhum (e um que nem é número) volta 404, nunca um arquivo.
    for (const rota of ["pdf", "imagem"]) {
      expect((await page.request.get(`/api/roteiros/99999999/${rota}`)).status()).toBe(404);
      expect((await page.request.get(`/api/roteiros/abc/${rota}`)).status()).toBe(404);
    }
  });

  test("o menu da agenda do Hoje tem 'Baixar em PDF', entre 'Não vou gravar hoje' e 'Não gostei, quero outro', e baixa o arquivo", async ({ page }) => {
    test.setTimeout(90_000);
    const titulo = `agenda exportar ${Date.now()}`;
    // Sozinho no dia ele é o destaque, no alto da tela: o menu das linhas de baixo fecha quando a página rola para mostrá-las.
    await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
    await criarRoteiro(titulo);
    // A tela alta o bastante para o Playwright não rolar a página até o botão: do tablet para cima, rolar fecha o menu (`PainelFlutuante`), e o evento de rolagem chega depois de o menu abrir.
    await page.setViewportSize({ width: 1280, height: 1500 });
    await entrar(page);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Mais opções: ${titulo}` }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["Não vou gravar hoje", "Baixar em PDF", "Não gostei, quero outro", "Arquivar"]);

    const download = page.waitForEvent("download");
    await menu.getByRole("menuitem", { name: "Baixar em PDF" }).click();
    expect((await download).suggestedFilename()).toBe(`roteiro-${hojeISO()}.pdf`);
    await expect(page.getByRole("status").filter({ hasText: "PDF do roteiro pronto" })).toBeVisible();
  });

  test("o PDF que falha mostra a frase dentro do menu da agenda, que continua aberto, e nada baixa", async ({ page }) => {
    test.setTimeout(90_000);
    const titulo = `agenda exportar falha ${Date.now()}`;
    await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
    await criarRoteiro(titulo);
    await page.setViewportSize({ width: 1280, height: 1500 });
    await entrar(page);
    await page.waitForLoadState("networkidle");
    await page.route("**/api/roteiros/*/pdf", (rota) => rota.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ erro: "x" }) }));

    await page.getByRole("button", { name: `Mais opções: ${titulo}` }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Baixar em PDF" }).click();
    await expect(page.getByRole("menu").getByRole("alert")).toContainText("Não conseguimos gerar o PDF agora");
    await expect(page.getByRole("status").filter({ hasText: "PDF do roteiro pronto" })).toHaveCount(0);
    // O item volta a servir: a falha não deixa o "Gerando o PDF" preso.
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Baixar em PDF" })).toBeEnabled();
  });
});
