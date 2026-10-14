/**
 * O modo gravação do vídeo longo (E52, PR 5, passo 26) e as marcas de fala do roteiro longo: um capítulo por vez, "Já gravei este" marca e avança, a seta da direita passa sem marcar, o fim só
 * com todos marcados e "Copiar os capítulos" nele; a memória é do aparelho; o roteiro curto segue com o modo gravação de sempre. Grava marca e roteiros direto no banco, sem IA de verdade (o
 * simulador escreve as marcas). Seguro para a repetição automática do Playwright.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type CapituloDoRoteiro, type ConteudoRoteiro } from "../../src/db/schema";
import { camposCorridosDosCapitulos, capitulosParaCopiar, somaDosCapitulos } from "../../src/lib/capitulos-do-roteiro";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const USUARIO = "e2e-gravacao-longa";
const EMAIL = `${USUARIO}@exemplo.teste`;

let clienteId = 0;

const CAPITULOS: CapituloDoRoteiro[] = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 60, tom: "direto", pontos: ["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"], naImagem: "o sofá com a mancha", ganchoParaOProximo: "Fica até o fim que eu te mostro os três erros.", comoEditar: "Corte a cada 5 segundos" },
  { nome: "Erro 1: esfregar antes do tempo", inicioS: 60, duracaoS: 90, tom: "calmo", pontos: ["Aplique e mostre o relógio", "Explique que esfregar espalha a sujeira"], naImagem: "o relógio na parede", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete com o melhor produto.", comoEditar: "Acelere a espera" },
  { nome: "Erro 2: produto demais", inicioS: 150, duracaoS: 90, tom: "calmo", pontos: ["Mostre a quantidade certa na tampa", "Compare com a que as pessoas usam"], naImagem: "duas tampas lado a lado", ganchoParaOProximo: "O terceiro erro acontece depois que a mancha já saiu.", comoEditar: "Nenhum efeito" },
  { nome: "O que fazer amanhã", inicioS: 240, duracaoS: 60, tom: "firme", pontos: ["Resuma os erros em uma frase cada", "Peça a mensagem com a foto da mancha"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Termine olhando para a câmera" },
];

function conteudoLongo(titulo: string): ConteudoRoteiro {
  const corridos = camposCorridosDosCapitulos(CAPITULOS);
  return {
    titulo,
    duracaoS: somaDosCapitulos(CAPITULOS),
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto.",
    corpo: corridos.corpo,
    fechamento: corridos.fechamento,
    chamadaFinal: "Me manda a foto da sua mancha que eu digo o que usar.",
    cartoes: null,
    porQueAssim: [],
    cenas: corridos.cenas,
    ondeGravar: "na sala de casa",
    edicao: { textoNaTela: [], ritmoDeCorte: "Mais calmo que o vídeo curto.", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    capitulos: CAPITULOS,
    miniatura: "O sofá com a mancha",
  };
}

async function criarLongo(titulo: string): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId, data: hojeISO(), tema: titulo, origem: "livre", objetivo: "alcance", duracaoDoVideo: "longo", conteudo: conteudoLongo(titulo) })
    .returning({ id: roteiros.id });
  return linha.id;
}

async function criarCurto(titulo: string): Promise<number> {
  const conteudo: ConteudoRoteiro = {
    ...conteudoLongo(titulo),
    capitulos: null,
    miniatura: null,
    duracaoS: 40,
    corpo: "Mostre a peça com a mancha de volta.",
    fechamento: "Mostre a peça limpa.",
    cenas: [],
  };
  const [linha] = await db().insert(roteiros).values({ clienteId, data: hojeISO(), tema: titulo, origem: "livre", objetivo: "alcance", conteudo }).returning({ id: roteiros.id });
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

test.describe("o modo gravação do vídeo longo", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, USUARIO));
    if (existente) {
      clienteId = existente.id;
    } else {
      const [nicho] = await db().insert(nichos).values({ slug: `${USUARIO}-nicho`, nome: "[teste] Sofá gravação" }).returning();
      await db().insert(user).values({ id: USUARIO, name: "[teste] Gravação longa", email: EMAIL });
      await db().insert(account).values({ id: `${USUARIO}-credential`, issuer: "local:credential", accountId: USUARIO, providerId: "credential", userId: USUARIO, password: await hashPassword(SENHA) });
      const [cliente] = await db().insert(clientes).values({ usuarioId: USUARIO, nome: "[teste] Gravação longa", nichoId: nicho.id }).returning();
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

  test("um capítulo por vez: 'Já gravei este' marca e avança, a seta passa sem marcar, e o fim só vem com todos marcados", async ({ page }, info) => {
    const id = await criarLongo(`gravacao longa ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}/gravar`);

    const palco = page.locator("[data-capitulo-da-vez]");
    await expect(palco).toContainText("Capítulo 1 de 4 · 0:00 a 1:00");
    await expect(palco.getByRole("heading", { name: "A mancha que volta" })).toBeVisible();
    await expect(palco.locator("[data-gancho-do-video]")).toContainText("Se a mancha volta dois dias depois");
    await expect(palco.locator("[data-segurar]")).toContainText("Fica até o fim que eu te mostro os três erros.");
    await expect(palco.locator("[data-na-imagem]")).toContainText("o sofá com a mancha");
    await expect(palco).toContainText("Depois vem o capítulo 2, de 1:00 a 2:30");

    // a seta da direita passa sem marcar
    await page.getByRole("button", { name: "Próximo capítulo, sem marcar" }).click();
    await expect(palco).toContainText("Capítulo 2 de 4");
    await expect(page.locator("[data-passo-gravado]")).toHaveCount(0);

    // "Já gravei este" marca o 2 e passa ao 3, marca o 3 e passa ao 4, marca o 4: o 1 ainda falta, então a tela volta a ele (o fim não aparece)
    await page.getByRole("button", { name: /^Já gravei este/ }).click();
    await expect(palco).toContainText("Capítulo 3 de 4");
    await page.getByRole("button", { name: /^Já gravei este/ }).click();
    await expect(palco).toContainText("Capítulo 4 de 4");
    // o último troca a frase que segura pela chamada final
    await expect(palco.locator("[data-segurar]")).toHaveCount(0);
    await expect(palco.locator("[data-chamada-final]")).toContainText("Me manda a foto da sua mancha");
    await page.getByRole("button", { name: /^Já gravei este/ }).click();
    await expect(palco).toContainText("Capítulo 1 de 4");
    await expect(page.locator("[data-gravacao-longa-fim]")).toHaveCount(0);
    expect((await db().select().from(roteiros).where(eq(roteiros.id, id)))[0].status).toBe("gerado");

    // o último que falta: o fim aparece, com a lista e "Copiar os capítulos"
    await page.getByRole("button", { name: /^Já gravei este/ }).click();
    const fim = page.locator("[data-gravacao-longa-fim]");
    await expect(fim).toBeVisible();
    await expect(fim).toContainText("Os quatro capítulos estão gravados");
    await expect(fim.getByRole("listitem")).toHaveCount(4);
    await expect(fim).toContainText("confira depois de editar");
    await fim.getByRole("button", { name: "Copiar os capítulos" }).click();
    await expect(fim.getByText("Capítulos copiados")).toBeVisible();
    // A área de transferência do Windows devolve o fim de linha dele (CRLF); o que a tela copia é LF.
    const copiado = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(copiado).toBe(capitulosParaCopiar(CAPITULOS));
    // o roteiro ficou gravado no servidor
    await expect.poll(async () => (await db().select().from(roteiros).where(eq(roteiros.id, id)))[0].status).toBe("gravado");

    // "Voltar ao roteiro" leva ao roteiro com o aviso de gravado
    await page.getByRole("button", { name: "Voltar ao roteiro" }).click();
    await expect(page).toHaveURL(new RegExp(`/roteiros/${id}\\?gravado=1`));
  });

  test("a memória do aparelho: ao voltar, o modo gravação abre no primeiro capítulo que falta, e a seta do anterior sai do fim", async ({ page }, info) => {
    const id = await criarLongo(`gravacao memoria ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}/gravar`);
    const palco = page.locator("[data-capitulo-da-vez]");
    await expect(palco).toContainText("Capítulo 1 de 4");
    await page.getByRole("button", { name: /^Já gravei este/ }).click();
    await page.getByRole("button", { name: /^Já gravei este/ }).click();
    await expect(palco).toContainText("Capítulo 3 de 4");

    await page.reload();
    await expect(page.locator("[data-capitulo-da-vez]")).toContainText("Capítulo 3 de 4");
    await expect(page.locator("[data-passo-gravado]")).toHaveCount(2);

    // a memória é por roteiro: outro roteiro começa do zero
    const outro = await criarLongo(`gravacao outro ${info.retry}`);
    await page.goto(`/roteiros/${outro}/gravar`);
    await expect(page.locator("[data-capitulo-da-vez]")).toContainText("Capítulo 1 de 4");
    await expect(page.locator("[data-passo-gravado]")).toHaveCount(0);
  });

  test("a 390 o modo gravação do longo não ganha rolagem de lado e os controles ficam à vista", async ({ page }, info) => {
    const id = await criarLongo(`gravacao celular ${info.retry}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto(`/roteiros/${id}/gravar`);
    await expect(page.locator("[data-capitulo-da-vez]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const botao = await page.getByRole("button", { name: /^Já gravei este/ }).boundingBox();
    expect(botao!.y + botao!.height).toBeLessThanOrEqual(844);
  });

  test("o roteiro curto continua com o modo gravação de sempre (blocos, 'Próximo bloco')", async ({ page }, info) => {
    const id = await criarCurto(`gravacao curto ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}/gravar`);
    await expect(page.getByRole("button", { name: "Próximo bloco" })).toBeVisible();
    await expect(page.locator("[data-gravacao-longa]")).toHaveCount(0);
  });

  test("no roteiro longo a chave 'Marcas de fala' existe, as marcas são escritas e o texto que se lê é o do roteiro; os pontos não levam marca", async ({ page }, info) => {
    const id = await criarLongo(`marcas longo ${info.retry}`);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    // ao abrir, o pedido das marcas corre em segundo plano; com a chave ligada elas aparecem
    await expect.poll(async () => (await db().select().from(roteiros).where(eq(roteiros.id, id)))[0].marcasDeFala !== null, { timeout: 30_000 }).toBe(true);
    const chave = page.getByRole("switch", { name: /Marcas de fala/ });
    await expect(chave).toBeVisible();
    await chave.click();
    const primeiro = page.getByRole("region", { name: "A mancha que volta" });
    // o texto da frase é o do roteiro, letra por letra
    await expect(primeiro.locator("dd").filter({ hasText: "Fica até o fim que eu te mostro os três erros." }).first()).toBeVisible();
    await expect(primeiro.getByText("Mostre o sofá com a mancha de volta")).toBeVisible();
    // as marcas guardadas são das frases ditas, nunca dos pontos
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    const guardado = JSON.stringify(linha.marcasDeFala);
    for (const ponto of CAPITULOS.flatMap((c) => c.pontos)) expect(guardado).not.toContain(ponto);
    expect(linha.marcasDeFala?.blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "chamadaFinal"]);
  });
});
