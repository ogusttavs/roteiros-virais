/**
 * E50 parte 2, PR 4: o "Por quê" de cada bloco do roteiro. Fechado é só a palavra; aberto traz "O que faz", "Com base em" e "Para"; "Ver os porquês" abre todos; as frases na tela têm o seu;
 * roteiro antigo, sem `porQueDosBlocos`, não mostra a palavra. O roteiro entra direto no banco: o texto de cada por quê vem da tabela, por código.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-por-que@exemplo.teste";
const ID_USUARIO = "e2e-por-que";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

let clienteId: number;

/** O roteiro entra direto no banco (não depende da geração): o texto é conhecido e as marcas viram do simulador. */
async function criarRoteiro(comPorQue: boolean): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: "2026-10-10",
      tema: "a mancha que volta",
      origem: "livre",
      objetivo: "conversao",
      formato: "reels",
      conteudo: {
        titulo: "A mancha que volta",
        duracaoS: 30,
        gancho: "A mancha voltou depois da limpeza e ninguém te conta o porquê.",
        corpo: "Quase sempre sobra produto fundo no tecido. Passe água morna e depois o tira-mancha, sem esfregar.",
        fechamento: "Em dois minutos o banco fica limpo de novo.",
        chamadaFinal: "Chame no WhatsApp e peça o kit por R$ 89.",
        cartoes: null,
        porQueAssim: [],
        ...(comPorQue
          ? {
              porQueDosBlocos: [
                { bloco: "gancho", regras: ["R-COPY-05"], para: "fiquem" },
                { bloco: "corpo", regras: ["R-COPY-13", "R-COPY-12"], para: "confiem" },
                { bloco: "chamada", regras: ["R-COPY-25"], para: "chamem" },
                { bloco: "tela:0", regras: ["R-COPY-12"] },
              ],
            }
          : {}),
        cenas: [],
        ondeGravar: "no seu carro",
        edicao: { textoNaTela: [{ quando: "0 a 2 s", oQue: "a mancha voltou?", onde: "no topo" }], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: true,
        forcaEvidencia: null,
      },
    })
    .returning({ id: roteiros.id });
  return linha.id;
}

test.describe("E50 2 PR 4: o por quê de cada bloco", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID_USUARIO));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID_USUARIO));
      clienteId = marca.id;
      return;
    }
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-por-que", nome: "[teste] Por que" }).returning();
    await db().insert(user).values({ id: ID_USUARIO, name: "[teste] Por que", email: EMAIL });
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
    const [marca] = await db().insert(clientes).values({ usuarioId: ID_USUARIO, nome: "[teste] Por que", nichoId: nicho.id }).returning();
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

  test("fechado só a palavra; abrir mostra o que faz, com base em e para; fechar esconde", async ({ page }) => {
    const id = await criarRoteiro(true);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    const botao = page.getByRole("button", { name: /^Por quê: / }).first();
    await expect(botao).toBeVisible();
    await expect(botao).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("O que faz:")).toHaveCount(0);

    await botao.click();
    await expect(botao).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("O que faz:")).toHaveCount(1);
    await expect(page.getByText("Com base em:")).toHaveCount(1);
    await expect(page.getByText("uma regra de escrita para vídeo")).toBeVisible();
    await expect(page.getByText("Que a pessoa fique até o fim.")).toBeVisible();
    // nunca o código da regra
    await expect(page.getByText(/R-COPY-[0-9]+/)).toHaveCount(0);

    await botao.click();
    await expect(page.getByText("O que faz:")).toHaveCount(0);
  });

  test("'Ver os porquês' abre todos (os blocos e a frase na tela do Como editar) e 'Fechar os porquês' fecha", async ({ page }) => {
    const id = await criarRoteiro(true);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    await page.getByRole("button", { name: "Ver os porquês" }).click();
    // gancho, corpo, chamada e a frase na tela
    await expect(page.getByText("O que faz:")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Por quê: Texto na tela" })).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: "Fechar os porquês" }).click();
    await expect(page.getByText("O que faz:")).toHaveCount(0);
  });

  test("roteiro antigo, sem porquês, não mostra a palavra nem o botão do alto", async ({ page }) => {
    const id = await criarRoteiro(false);
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    await expect(page.getByRole("heading", { name: "A mancha que volta" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Por quê/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver os porquês" })).toHaveCount(0);
  });
});
