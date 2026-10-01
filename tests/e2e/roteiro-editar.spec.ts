/**
 * E40, item 1 e item 4: "editar uma palavra de um roteiro e ver no Histórico". Grava um roteiro
 * direto no banco (mesma lição de `historico.spec.ts`: cliente próprio, sem `resetarSchema`,
 * status "gravado" para aparecer no Histórico), edita o gancho pela tela, confere o toast e que
 * a versão editada persiste depois de sair e voltar pelo Histórico (não é só estado local).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-editar-roteiro@exemplo.teste";

const CONTEUDO_MINIMO = {
  titulo: "titulo original do e2e",
  duracaoS: 40,
  gancho: "este e o gancho original, antes de qualquer edicao",
  corpo: "corpo do e2e",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("E40, editar o roteiro pela tela", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-editar-roteiro"));
    if (jaExiste) return;

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-editar-roteiro", nome: "[teste] Editar roteiro" })
      .returning();

    await db().insert(user).values({ id: "e2e-editar-roteiro", name: "[teste] Editar roteiro", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-editar-roteiro-credential",
        issuer: "local:credential",
        accountId: "e2e-editar-roteiro",
        providerId: "credential",
        userId: "e2e-editar-roteiro",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-editar-roteiro", aceitouTermosEm: new Date() });

    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-editar-roteiro", nome: "[teste] Editar roteiro", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-editar-roteiro", clienteId: cliente.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: cliente.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofa de 3 lugares por 180 reais",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicilio",
        referencias: [],
      },
    });

    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: hojeISO(),
        tema: "o roteiro que vou editar no e2e",
        origem: "sugerido",
        objetivo: "alcance",
        conteudo: CONTEUDO_MINIMO,
        status: "gravado",
        gravadoEm: new Date(),
      });
  });

  test("edita o gancho, salva, e a versao editada continua la depois de sair e voltar pelo Historico", async ({
    page,
  }) => {
    await entrar(page);
    await page.goto("/historico");

    const item = page.getByRole("link", { name: /o roteiro que vou editar no e2e/ });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    await expect(page.getByText("este e o gancho original, antes de qualquer edicao")).toBeVisible();

    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const campoGancho = page.getByLabel("Os 3 primeiros segundos");
    await expect(campoGancho).toHaveValue("este e o gancho original, antes de qualquer edicao");
    await campoGancho.fill("este e o gancho depois de eu editar pela tela");

    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Edição salva")).toBeVisible();

    // Depois de salvar, volta ao modo de leitura, com o texto novo.
    await expect(page.getByText("este e o gancho depois de eu editar pela tela")).toBeVisible();
    await expect(page.getByText("este e o gancho original, antes de qualquer edicao")).toHaveCount(0);

    // Sai para o Historico e volta pelo link, para provar que persistiu no servidor, nao so no estado da tela.
    await page.goto("/historico");
    await page.getByRole("link", { name: /o roteiro que vou editar no e2e/ }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    await expect(page.getByText("este e o gancho depois de eu editar pela tela")).toBeVisible();

    // "Editar" continua disponivel: outra edicao nao perde o original (so a primeira grava `conteudoOriginal`).
    await expect(page.getByRole("button", { name: "Editar", exact: true })).toBeVisible();
  });
});
