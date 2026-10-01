/**
 * V15, item 4, correção pedida pelo Fable na revisão do PR: o lado do Roteiro
 * (`RoteiroTela.tsx`, `.corpoComLado`) precisa deixar a ordem do celular
 * exatamente como já era antes da V15, movendo "Referência" e o cartão de
 * trabalho ("Como editar"/"Por que assim") para a segunda coluna só por CSS
 * (`grid-column`), nunca reordenando o documento. Este arquivo confere essa
 * ordem a 390px, no Reels falado e no Story, lendo o texto da página inteira
 * e comparando a posição de cada marco.
 */
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  user,
  videos,
  type ConteudoRoteiro,
} from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function entrar(page: import("@playwright/test").Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Índice de cada marco no texto da página; -1 (não achado) falha o teste explicitamente. */
function indiceDeTodos(texto: string, marcos: string[]): number[] {
  return marcos.map((marco) => {
    const indice = texto.indexOf(marco);
    expect(indice, `"${marco}" não apareceu na página`).toBeGreaterThanOrEqual(0);
    return indice;
  });
}

function confereCrescente(indices: number[], marcos: string[]) {
  for (let i = 1; i < indices.length; i++) {
    expect(
      indices[i],
      `"${marcos[i]}" deveria vir depois de "${marcos[i - 1]}" (ordem do celular não pode mudar)`,
    ).toBeGreaterThan(indices[i - 1]);
  }
}

test.describe("Roteiro a 390px: a ordem dos blocos não muda com o lado (V15, item 4)", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-roteiro-ordem"));
    if (jaExiste) return;

    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id: "e2e-roteiro-ordem", name: "[teste] Roteiro Ordem", email: "e2e-roteiro-ordem@exemplo.teste" });
    await db()
      .insert(account)
      .values({
        id: "e2e-roteiro-ordem-credential",
        issuer: "local:credential",
        accountId: "e2e-roteiro-ordem",
        providerId: "credential",
        userId: "e2e-roteiro-ordem",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-roteiro-ordem", nome: "[teste] Roteiro Ordem", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-roteiro-ordem", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-roteiro-ordem", aceitouTermosEm: new Date() });
    await db()
      .insert(briefings)
      .values({ clienteId: cliente.id, completo: true });

    const [video] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-roteiro-ordem-video",
        url: "https://exemplo.invalido/e2e-roteiro-ordem",
        nichoId: nicho.id,
        titulo: "video de referencia para o teste de ordem",
        foraDaCurva: "5",
        publicadoEm: new Date(),
        analise: {
          assunto: "teste",
          gancho: "gancho",
          estrutura: "estrutura",
          fechamento: "fechamento",
          chamadaFinal: "chamada",
          formato: "fala_para_camera",
          porQueFuncionou: "x",
        } as never,
      })
      .returning();

    // Reels falado: "Como editar" no lugar de sempre, sem legenda, sem porQueAssim (como em Reels falado hoje).
    const conteudoReels: ConteudoRoteiro = {
      titulo: "roteiro reels falado para o teste de ordem",
      duracaoS: 30,
      gancho: "gancho de teste",
      corpo: "corpo de teste",
      fechamento: "fechamento de teste",
      chamadaFinal: "chamada final de teste",
      cartoes: null,
      porQueAssim: [],
      cenas: [{ momento: "abertura", oQueFazer: "mostrar o produto" }],
      ondeGravar: "na sala",
      edicao: {
        textoNaTela: [],
        ritmoDeCorte: "moderado",
        recursos: [],
        audio: null,
        referencia: { videoId: video.id, segundo: 2, oQueOlhar: "o gancho" },
      },
      evidencias: [video.id],
      semEvidencia: false,
      forcaEvidencia: "media",
    };
    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: "2026-01-01",
        tema: conteudoReels.titulo,
        origem: "sugerido",
        objetivo: "conversao",
        formato: "reels",
        estilo: "falado",
        conteudo: conteudoReels,
        referenciaVideoId: video.id,
      });

    // Story: cartões na coluna, "Por que assim" no lugar de sempre (depois da legenda), "Referência" por último.
    const conteudoStory: ConteudoRoteiro = {
      titulo: "roteiro story para o teste de ordem",
      duracaoS: 20,
      gancho: "",
      corpo: "",
      fechamento: "",
      chamadaFinal: "",
      cartoes: [
        { oQueFalar: "fala do story", oQueMostrar: "mostra o produto", textoNaTela: "texto na tela", figurinha: "nenhuma" },
      ],
      porQueAssim: [{ regra: "R-IG-STORY-03", motivo: "sequencia de stories dentro do teto de 60 segundos" }],
      cenas: [{ momento: "abertura", oQueFazer: "mostrar o produto" }],
      ondeGravar: "na sala",
      edicao: {
        textoNaTela: [],
        ritmoDeCorte: "moderado",
        recursos: [],
        audio: null,
        referencia: { videoId: video.id, segundo: 2, oQueOlhar: "o gancho" },
      },
      evidencias: [video.id],
      semEvidencia: false,
      forcaEvidencia: "media",
    };
    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: "2026-01-02",
        tema: conteudoStory.titulo,
        origem: "sugerido",
        objetivo: "conversao",
        formato: "story",
        estilo: "falado",
        conteudo: conteudoStory,
        referenciaVideoId: video.id,
      });
  });

  test("Reels falado: cartão (ou 'Como editar') -> 'De onde veio' -> 'Outras versões', sem porQueAssim", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-roteiro-ordem@exemplo.teste");
    const [roteiro] = await db()
      .select({ id: roteiros.id })
      .from(roteiros)
      .where(eq(roteiros.tema, "roteiro reels falado para o teste de ordem"));
    await page.goto(`/roteiros/${roteiro.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const texto = await page.locator("body").innerText();
    const marcos = ["Onde gravar e o que mostrar", "Como editar", "Referência", "Outras versões deste tema"];
    confereCrescente(indiceDeTodos(texto, marcos), marcos);
  });

  test("Story: cartões -> 'Por que assim' -> 'De onde veio' -> 'Outras versões'", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-roteiro-ordem@exemplo.teste");
    const [roteiro] = await db()
      .select({ id: roteiros.id })
      .from(roteiros)
      .where(eq(roteiros.tema, "roteiro story para o teste de ordem"));
    await page.goto(`/roteiros/${roteiro.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const texto = await page.locator("body").innerText();
    const marcos = ["Onde gravar e o que mostrar", "Por que assim", "Referência", "Outras versões deste tema"];
    confereCrescente(indiceDeTodos(texto, marcos), marcos);
  });
});
