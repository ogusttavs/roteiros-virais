/**
 * O roteiro do vídeo longo do YouTube na tela (E52, PR 4b, passo 25 do Opus): a lista de capítulos com o tempo e o "Copiar os capítulos", um cartão por capítulo, a edição de um capítulo por
 * vez (o texto corrido que o resto do produto lê é refeito no servidor), o selo da duração no Histórico e no Hoje, e o PDF por capítulo; a imagem 9:16 não existe para o longo. O roteiro curto
 * segue igual (regressão). Grava marca e roteiros direto no banco, sem IA: o que se prova aqui é a tela e o que ela manda ao servidor. Seguro para a repetição automática do Playwright.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type CapituloDoRoteiro, type ConteudoRoteiro } from "../../src/db/schema";
import { capitulosParaCopiar, somaDosCapitulos } from "../../src/lib/capitulos-do-roteiro";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const USUARIO = "e2e-roteiro-longo";
const EMAIL = `${USUARIO}@exemplo.teste`;

let clienteId = 0;

const CAPITULOS: CapituloDoRoteiro[] = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 60, tom: "direto", pontos: ["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"], naImagem: "o sofá com a mancha", ganchoParaOProximo: "Fica até o fim que eu te mostro os três erros", comoEditar: "Corte a cada 5 segundos" },
  { nome: "Erro 1: esfregar antes do tempo", inicioS: 60, duracaoS: 90, tom: "calmo", pontos: ["Aplique e mostre o relógio", "Explique que esfregar espalha a sujeira"], naImagem: "o relógio na parede", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete", comoEditar: "Acelere a espera" },
  { nome: "Erro 2: produto demais", inicioS: 150, duracaoS: 90, tom: "calmo", pontos: ["Mostre a quantidade certa na tampa", "Compare com a que as pessoas usam"], naImagem: "duas tampas lado a lado", ganchoParaOProximo: "O terceiro erro acontece depois que a mancha já saiu", comoEditar: "Nenhum efeito" },
  { nome: "O que fazer amanhã", inicioS: 240, duracaoS: 60, tom: "firme", pontos: ["Resuma os erros em uma frase cada", "Peça a mensagem com a foto da mancha"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Termine olhando para a câmera" },
];

function conteudoLongo(titulo: string): ConteudoRoteiro {
  const duracaoS = somaDosCapitulos(CAPITULOS);
  return {
    titulo,
    duracaoS,
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto.",
    corpo: CAPITULOS.map((c, i) => `${i + 1}. ${c.nome}: ${c.pontos.join("; ")}`).join("\n"),
    fechamento: CAPITULOS[CAPITULOS.length - 1].pontos.join("; "),
    chamadaFinal: "Me manda a foto da sua mancha que eu digo o que usar.",
    cartoes: null,
    porQueAssim: [],
    cenas: CAPITULOS.map((c) => ({ momento: `${c.inicioS} segundos`, oQueFazer: c.naImagem })),
    ondeGravar: "na sala de casa",
    edicao: { textoNaTela: [{ quando: "0 a 2 s", onde: "no topo", oQue: "a mancha voltou?" }], ritmoDeCorte: "Mais calmo que o vídeo curto.", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    capitulos: CAPITULOS,
    miniatura: "O sofá com a mancha e o texto: volta sempre?",
  };
}

function conteudoCurto(titulo: string): ConteudoRoteiro {
  return {
    titulo,
    duracaoS: 40,
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto.",
    corpo: "Mostre a peça com a mancha de volta.",
    fechamento: "Mostre a peça limpa.",
    chamadaFinal: "Me manda uma mensagem.",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "na área de serviço",
    edicao: { textoNaTela: [], ritmoDeCorte: "Um corte a cada 4 segundos.", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
  };
}

async function criarLongo(titulo: string): Promise<number> {
  const conteudo = conteudoLongo(titulo);
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId, data: hojeISO(), tema: titulo, origem: "livre", objetivo: "alcance", duracaoDoVideo: "longo", conteudo })
    .returning({ id: roteiros.id });
  return linha.id;
}

async function criarCurto(titulo: string): Promise<number> {
  const [linha] = await db().insert(roteiros).values({ clienteId, data: hojeISO(), tema: titulo, origem: "livre", objetivo: "alcance", conteudo: conteudoCurto(titulo) }).returning({ id: roteiros.id });
  return linha.id;
}

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.describe("o roteiro longo na tela", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, USUARIO));
    if (existente) {
      clienteId = existente.id;
    } else {
      const [nicho] = await db().insert(nichos).values({ slug: `${USUARIO}-nicho`, nome: "[teste] Sofá" }).returning();
      await db().insert(user).values({ id: USUARIO, name: "[teste] Longo na tela", email: EMAIL });
      await db().insert(account).values({ id: `${USUARIO}-credential`, issuer: "local:credential", accountId: USUARIO, providerId: "credential", userId: USUARIO, password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: USUARIO, nome: "[teste] Longo na tela", nichoId: nicho.id }).returning();
      clienteId = cliente.id;
      await db().insert(membrosMarca).values({ usuarioId: USUARIO, clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: USUARIO, aceitouTermosEm: new Date() });
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
    await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
  });

  test("abre com o selo da duração, a lista de capítulos com o tempo e um cartão por capítulo; os tempos fecham a duração do vídeo", async ({ page }, info) => {
    const id = await criarLongo(`longo na tela ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    await expect(page.locator("[data-selo-video-longo]")).toHaveText("YouTube, vídeo longo");
    await expect(page.locator("[data-duracao-do-video]")).toHaveText("Vídeo longo, uns 5 min");
    await expect(page.getByText("4 capítulos")).toBeVisible();

    const indice = page.getByRole("region", { name: "Os capítulos" });
    const itens = await indice.getByRole("listitem").allTextContents();
    expect(itens).toEqual(["0:00A mancha que volta", "1:00Erro 1: esfregar antes do tempo", "2:30Erro 2: produto demais", "4:00O que fazer amanhã"]);

    // um cartão por capítulo, com o tempo "de a até" e o último terminando na duração do vídeo (300 s = 5:00)
    await expect(page.locator("[data-capitulo]")).toHaveCount(4);
    await expect(page.getByRole("region", { name: "A mancha que volta" })).toContainText("Capítulo 1 · 0:00 a 1:00");
    await expect(page.getByRole("region", { name: "O que fazer amanhã" })).toContainText("Capítulo 4 · 4:00 a 5:00");
    // o primeiro traz o gancho do vídeo; o último, a chamada e nenhum gancho para o próximo
    await expect(page.getByRole("region", { name: "A mancha que volta" }).getByText("O gancho do vídeo")).toBeVisible();
    await expect(page.getByRole("region", { name: "O que fazer amanhã" }).getByText("Para segurar até o próximo")).toHaveCount(0);

    // o longo não oferece o "Editar" do roteiro inteiro, nem a chave das marcas; "Como editar o vídeo inteiro" está no lado
    await expect(page.getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
    await expect(page.getByText("Marcas de fala")).toHaveCount(0);
    await expect(page.getByText("Como editar o vídeo inteiro")).toBeVisible();
    // e a imagem 9:16 não está no menu: dez minutos de vídeo não cabem num quadro
    await page.getByRole("button", { name: "Mais opções" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Baixar em PDF" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Guardar como imagem no celular" })).toHaveCount(0);
  });

  test("'Copiar os capítulos' põe a lista da descrição do YouTube na área de transferência", async ({ page }, info) => {
    const id = await criarLongo(`longo copiar ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await page.getByRole("button", { name: "Copiar os capítulos" }).click();
    await expect(page.getByText("Capítulos copiados")).toBeVisible();
    // A área de transferência do Windows devolve o fim de linha dele (CRLF); o que a tela copia é LF.
    const copiado = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(copiado).toBe(capitulosParaCopiar(CAPITULOS));
    expect(copiado.split("\n")[0]).toBe("00:00 A mancha que volta");
    expect(copiado.split("\n")).toHaveLength(4);
  });

  test("editar um capítulo muda só ele e o texto corrido acompanha; recarregar mostra o que foi salvo", async ({ page }, info) => {
    const id = await criarLongo(`longo editar ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    await page.getByRole("button", { name: "Editar o capítulo Erro 1: esfregar antes do tempo" }).click();
    // um por vez: os botões dos outros capítulos saem enquanto um está aberto
    await expect(page.getByRole("button", { name: /^Editar o capítulo/ })).toHaveCount(0);
    await page.getByLabel("Para segurar até o próximo").fill("E o erro seguinte pega até quem já sabe");
    await page.getByLabel("O que falar (um ponto por linha)").fill("Aplique e espere o tempo do rótulo\n\nNão esfregue antes de acabar o tempo");
    await page.getByRole("button", { name: "Salvar o capítulo" }).click();

    await expect(page.getByText("Edição salva")).toBeVisible();
    const card = page.getByRole("region", { name: "Erro 1: esfregar antes do tempo" });
    await expect(card.getByText("E o erro seguinte pega até quem já sabe")).toBeVisible();
    await expect(card.getByText("Não esfregue antes de acabar o tempo")).toBeVisible();

    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    const caps = linha.conteudo.capitulos!;
    expect(caps[1].pontos).toEqual(["Aplique e espere o tempo do rótulo", "Não esfregue antes de acabar o tempo"]);
    expect(caps[1].ganchoParaOProximo).toBe("E o erro seguinte pega até quem já sabe");
    [0, 2, 3].forEach((i) => expect(caps[i]).toEqual(CAPITULOS[i]));
    // os tempos e a duração não mudam; o texto corrido (o que o resto do produto lê) foi refeito no servidor
    expect(caps.map((c) => c.inicioS)).toEqual([0, 60, 150, 240]);
    expect(linha.conteudo.duracaoS).toBe(300);
    expect(linha.conteudo.corpo).toContain("2. Erro 1: esfregar antes do tempo: Aplique e espere o tempo do rótulo; Não esfregue antes de acabar o tempo");
    expect(linha.editadoPelaPessoa).toBe(true);

    await page.reload();
    await expect(page.getByRole("region", { name: "Erro 1: esfregar antes do tempo" }).getByText("Não esfregue antes de acabar o tempo")).toBeVisible();
  });

  test("o servidor que recusa mostra a frase dentro do cartão e nada muda", async ({ page }, info) => {
    const id = await criarLongo(`longo recusa ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await page.getByRole("button", { name: "Editar o capítulo A mancha que volta" }).click();
    // nenhum ponto sobra depois de limpar as linhas vazias: a tela diz a frase e nada vai ao servidor
    await page.getByLabel("O que falar (um ponto por linha)").fill("   ");
    await page.getByRole("button", { name: "Salvar o capítulo" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Deixe de 1 a 8 pontos" })).toBeVisible();
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(linha.conteudo.capitulos![0].pontos).toEqual(CAPITULOS[0].pontos);
    expect(linha.editadoPelaPessoa).toBe(false);
  });

  test("o PDF do longo sai (mais de uma página: as seções e a lista para colar) e a imagem 9:16 é recusada", async ({ page }, info) => {
    test.setTimeout(120_000);
    const id = await criarLongo(`longo pdf ${info.retry}`);
    await entrar(page);
    const pdf = await page.request.get(`/api/roteiros/${id}/pdf`, { timeout: 60_000 });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const corpo = await pdf.body();
    expect(corpo.subarray(0, 4).toString()).toBe("%PDF");
    // a lista para colar começa numa página nova: o PDF tem pelo menos duas páginas
    const paginas = (corpo.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    expect(paginas).toBeGreaterThanOrEqual(2);

    const imagem = await page.request.get(`/api/roteiros/${id}/imagem`, { timeout: 30_000 });
    expect(imagem.status()).toBe(400);
  });

  test("o Histórico e o Hoje dizem 'vídeo longo, uns N min' no lugar dos segundos", async ({ page }, info) => {
    await criarLongo(`longo lista ${info.retry}`);
    await entrar(page);
    await expect(page.getByText("Vídeo longo, uns 5 min")).toBeVisible();
    await page.goto("/historico");
    await expect(page.getByText("vídeo longo, uns 5 min").first()).toBeVisible();
  });

  test("a 390 o roteiro longo não ganha rolagem de lado", async ({ page }, info) => {
    const id = await criarLongo(`longo celular ${info.retry}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await expect(page.locator("[data-capitulo]")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("o roteiro curto segue igual: os quatro blocos, o Editar do roteiro, a duração em segundos e a imagem no menu", async ({ page }, info) => {
    const id = await criarCurto(`curto regressao ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await expect(page.locator("[data-roteiro-longo]")).toHaveCount(0);
    await expect(page.getByText("Os 3 primeiros segundos")).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar", exact: true })).toBeVisible();
    await expect(page.getByText("40 s", { exact: true })).toBeVisible();
    await expect(page.getByText("Vídeo longo")).toHaveCount(0);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Guardar como imagem no celular" })).toBeVisible();
  });
});
