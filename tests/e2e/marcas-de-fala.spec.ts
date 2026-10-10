/**
 * E41 parte 2b: as marcas de fala na tela. Roteiro: a chave vem desligada, ligar mostra o texto marcado (as marcas são desenhos: o texto lido continua o do roteiro) e o tom de cada
 * bloco, "Como ler as marcas" abre a folha com a frase fixa da voz. Modo gravação: as marcas vêm ligadas, desligar é lembrado por marca, e a chave sai da tela em Story.
 * Corre com o simulador de IA (`AI_PROVIDER=mock`): o simulador põe peso na palavra mais comprida de cada frase e o código completa as pausas.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-marcas-de-fala@exemplo.teste";
const ID_USUARIO = "e2e-marcas-de-fala";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

let clienteId: number;

/** O roteiro entra direto no banco (não depende da geração): o texto é conhecido e as marcas viram do simulador. */
async function criarRoteiro(formato: "reels" | "story" = "reels"): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: "2026-10-10",
      tema: "a mancha que volta",
      origem: "livre",
      objetivo: "conversao",
      formato,
      conteudo: {
        titulo: "A mancha que volta",
        duracaoS: 30,
        gancho: "A mancha voltou depois da limpeza e ninguém te conta o porquê.",
        corpo: "Quase sempre sobra produto fundo no tecido. Passe água morna e depois o tira-mancha, sem esfregar.",
        fechamento: "Em dois minutos o banco fica limpo de novo.",
        chamadaFinal: "Chame no WhatsApp e peça o kit por R$ 89.",
        cartoes:
          formato === "story"
            ? [
                { oQueFalar: "Olha esta mancha", oQueMostrar: "o banco", textoNaTela: "mancha", figurinha: "nenhuma" },
                { oQueFalar: "Ela voltou", oQueMostrar: "o tecido", textoNaTela: "voltou", figurinha: "nenhuma" },
              ]
            : null,
        porQueAssim: [],
        cenas: [],
        ondeGravar: "no seu carro",
        edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: true,
        forcaEvidencia: null,
      },
    })
    .returning({ id: roteiros.id });
  return linha.id;
}

test.describe("E41 2b: as marcas de fala na tela", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID_USUARIO));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID_USUARIO));
      clienteId = marca.id;
      return;
    }
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-marcas-de-fala", nome: "[teste] Marcas de fala" }).returning();
    await db().insert(user).values({ id: ID_USUARIO, name: "[teste] Marcas", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: `${ID_USUARIO}-credential`,
        issuer: "local:credential",
        accountId: ID_USUARIO,
        providerId: "credential",
        userId: ID_USUARIO,
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID_USUARIO, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: ID_USUARIO, nome: "[teste] Marcas", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: ID_USUARIO, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "kit tira-mancha",
          preco: "kit por R$ 89",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "produtos de limpeza",
        referencias: [],
      },
    });
    clienteId = marca.id;
  });

  test("no roteiro a chave vem desligada; ligar mostra as marcas e o tom, e o texto continua o do roteiro", async ({ page }) => {
    const id = await criarRoteiro();
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    const chave = page.getByRole("switch", { name: "Marcas de fala" });
    await expect(chave).toBeVisible();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("img", { name: "pausa longa" })).toHaveCount(0);
    await expect(page.getByText("Tom: direto.")).toHaveCount(0);

    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    // As marcas chegam (o pedido correu em segundo plano ao abrir, ou corre agora, com a espera à vista).
    await expect(page.getByRole("img", { name: "pausa longa" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Tom: direto.")).toBeVisible();
    await expect(page.getByText("Tom: firme.")).toBeVisible();
    await expect(page.getByRole("img", { name: "tom desce" }).first()).toBeVisible();

    // O registro do conserto e o que o modelo errou não vão para o navegador. Com as marcas já guardadas, a página nova traz a carga do servidor com o roteiro: ela não pode levá-las.
    await page.reload();
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toBeVisible();
    const html = await page.content();
    expect(html).toContain("A mancha voltou depois da limpeza"); // a carga do servidor está na página
    expect(html).not.toContain("semModelo");
    expect(html).not.toContain("correcoes");
    await chave.click();
    await expect(page.getByRole("img", { name: "pausa longa" }).first()).toBeVisible();

    // O texto lido é o mesmo, sem uma letra a mais: o gancho inteiro continua na tela.
    await expect(page.locator("article").filter({ hasText: "A mancha voltou depois da limpeza e ninguém te conta o porquê." }).first()).toBeVisible();

    // Desligar volta ao texto de sempre.
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("img", { name: "pausa longa" })).toHaveCount(0);
  });

  test("'Como ler as marcas' abre a folha com as seis marcas e a frase fixa da voz, e fecha", async ({ page }) => {
    const id = await criarRoteiro();
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await page.getByRole("switch", { name: "Marcas de fala" }).click();
    await page.getByRole("button", { name: "Como ler as marcas" }).click();

    const folha = page.getByRole("dialog", { name: "Como ler as marcas" });
    await expect(folha).toBeVisible();
    for (const nome of ["Peso", "Pausa curta", "Pausa longa", "Devagar", "Tom desce", "Tom sobe", "O tom do bloco"]) {
      await expect(folha.getByText(nome, { exact: true })).toBeVisible();
    }
    await expect(folha.getByText(/procure um fonoaudiólogo ou um otorrinolaringologista/)).toBeVisible();
    await expect(folha.getByText(/Não existe marca de "rápido"/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(folha).toHaveCount(0);
  });

  test("no modo gravação as marcas vêm ligadas; desligar é lembrado por marca neste aparelho", async ({ page }) => {
    const id = await criarRoteiro();
    await entrar(page);
    // Abrir o roteiro pede as marcas em segundo plano: o modo gravação costuma encontrá-las prontas.
    await page.goto(`/roteiros/${id}`);
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toBeVisible();
    await page.waitForTimeout(1500);

    await page.goto(`/roteiros/${id}/gravar`);
    const chave = page.getByRole("switch", { name: "Marcas de fala" });
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("img", { name: "pausa longa" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Tom: direto.")).toBeVisible();

    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("img", { name: "pausa longa" })).toHaveCount(0);

    // Lembrado: ao voltar, continua desligada.
    await page.reload();
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("img", { name: "pausa longa" })).toHaveCount(0);

    // Ligar de novo apaga a memória.
    await page.getByRole("switch", { name: "Marcas de fala" }).click();
    await expect(page.getByRole("img", { name: "pausa longa" }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toHaveAttribute("aria-checked", "true");
  });

  test("com a escolha de desligar lembrada, o modo gravação não pede as marcas (não gasta)", async ({ page }) => {
    const id = await criarRoteiro();
    await entrar(page);
    // A memória do aparelho vale por marca: a chave do `localStorage` é a do modo gravação desta marca.
    await page.addInitScript((marca) => window.localStorage.setItem(`marcas-de-fala:gravacao:${marca}`, "desligadas"), clienteId);
    await page.goto(`/roteiros/${id}/gravar`);
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toHaveAttribute("aria-checked", "false");
    await page.waitForTimeout(2500);
    const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
    expect(linha.marcas).toBeNull();
    await expect(page.getByRole("img", { name: "pausa longa" })).toHaveCount(0);

    // Ligar a chave pede e mostra.
    await page.getByRole("switch", { name: "Marcas de fala" }).click();
    await expect(page.getByRole("img", { name: "pausa longa" }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("Story não tem a chave", async ({ page }) => {
    const id = await criarRoteiro("story");
    await entrar(page);
    await page.goto(`/roteiros/${id}`);
    await expect(page.getByRole("heading", { name: "A mancha que volta" }).first()).toBeVisible();
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toHaveCount(0);
    await page.goto(`/roteiros/${id}/gravar`);
    await expect(page.getByRole("switch", { name: "Marcas de fala" })).toHaveCount(0);
  });
});
