/**
 * Achado do Gustavo em produção (22/10/2026): tocou em "Já gravei" sem querer e a tela não tinha como desfazer. Aqui: o aviso logo depois de marcar traz "Desfazer"; o menu dos três pontos de um
 * roteiro já marcado como gravado traz "Ainda não gravei"; os dois voltam o roteiro a não gravado no banco (status e hora); e um roteiro já postado não oferece a opção.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type ConteudoRoteiro } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-desfazer-gravado@exemplo.teste";
const ID_USUARIO = "e2e-desfazer-gravado";

let marcaId: number;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const CONTEUDO: ConteudoRoteiro = {
  titulo: "A mancha que volta",
  duracaoS: 30,
  gancho: "A mancha voltou depois da limpeza.",
  corpo: "Quase sempre sobra produto fundo no tecido.",
  fechamento: "Em dois minutos o banco fica limpo de novo.",
  chamadaFinal: "Chame no WhatsApp.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no seu carro",
  edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function novoRoteiro(tema: string, extra: Partial<typeof roteiros.$inferInsert> = {}): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId: marcaId, data: "2026-10-10", tema, origem: "livre", objetivo: "conversao", formato: "reels", estilo: "falado", conteudo: CONTEUDO, ...extra })
    .returning({ id: roteiros.id });
  return linha.id;
}

async function lerRoteiro(id: number) {
  const [linha] = await db().select({ status: roteiros.status, gravadoEm: roteiros.gravadoEm }).from(roteiros).where(eq(roteiros.id, id));
  return linha;
}

test.describe("desfazer o Já gravei", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID_USUARIO));
    if (existente) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID_USUARIO));
      marcaId = marca.id;
      return;
    }
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
    await db().insert(user).values({ id: ID_USUARIO, name: "[teste] Desfazer gravado", email: EMAIL });
    await db()
      .insert(account)
      .values({ id: `${ID_USUARIO}-credential`, issuer: "local:credential", accountId: ID_USUARIO, providerId: "credential", userId: ID_USUARIO, password: await hashPassword(SENHA) });
    const [marca] = await db().insert(clientes).values({ usuarioId: ID_USUARIO, nome: "[teste] Desfazer gravado", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: ID_USUARIO, clienteId: marca.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID_USUARIO, aceitouTermosEm: new Date() });
    await db().insert(briefings).values({ clienteId: marca.id, completo: true });
    marcaId = marca.id;
  });

  test("o aviso depois de Já gravei traz Desfazer, e tocar nele volta o roteiro a não gravado", async ({ page }) => {
    const id = await novoRoteiro("desfazer pelo aviso");
    await entrar(page);
    await page.goto(`/roteiros/${id}`);

    await page.getByRole("button", { name: "Já gravei", exact: true }).click();
    await expect(page.getByRole("button", { name: "Postei", exact: true })).toBeVisible();
    await expect(page.getByText("Marcado como gravado.")).toBeVisible();
    expect((await lerRoteiro(id)).status).toBe("gravado");

    await page.getByRole("button", { name: "Desfazer", exact: true }).click();

    await expect(page.getByText("Voltou para não gravado.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Postei", exact: true })).toHaveCount(0);
    const depois = await lerRoteiro(id);
    expect(depois.status).toBe("gerado");
    expect(depois.gravadoEm).toBeNull();

    // Depois de recarregar a tela continua como não gravado.
    await page.reload();
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeVisible();
  });

  test("o menu de um roteiro já gravado traz Ainda não gravei, que volta o roteiro; o postado não oferece", async ({ page }) => {
    const gravado = await novoRoteiro("desfazer pelo menu", { status: "gravado", gravadoEm: new Date() });
    const postado = await novoRoteiro("postado nao desfaz", { status: "postado", gravadoEm: new Date(), postadoEm: new Date(), urlPostado: "https://exemplo.invalido/video" });
    await entrar(page);

    await page.goto(`/roteiros/${postado}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await expect(page.getByRole("menuitem", { name: "Copiar o texto do roteiro" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Ainda não gravei" })).toHaveCount(0);

    await page.goto(`/roteiros/${gravado}`);
    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Ainda não gravei" }).click();

    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeVisible();
    const depois = await lerRoteiro(gravado);
    expect(depois.status).toBe("gerado");
    expect(depois.gravadoEm).toBeNull();
    expect((await lerRoteiro(postado)).status).toBe("postado");
  });
});
