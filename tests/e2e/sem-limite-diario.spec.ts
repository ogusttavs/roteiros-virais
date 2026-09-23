/**
 * O plano `sem_limite` (V9b-0, `PROXIMO.md`): marca com o interruptor ligado
 * gera quantos roteiros quiser no mesmo dia e vê um cartão por roteiro,
 * sempre com os três temas visíveis abaixo. Marca `padrao` (o padrão do
 * schema, sem interruptor nenhum) continua vendo um cartão só, com "Ver os
 * outros temas de hoje" e "Trocar".
 *
 * Mesma lição de `temas-do-dia.spec.ts` e `roteiro.spec.ts`: grava briefing e
 * tema do dia direto no banco, e deixa só a geração do roteiro passar pelo
 * navegador, contra o `AI_PROVIDER=mock` do servidor. Nicho próprio
 * ("e2e-sem-limite"), sem `resetarSchema` (o seed roda uma vez só, no
 * globalSetup).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  temasDia,
  user,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const PERFIL_PADRAO = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
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
};

async function criarClienteComPlano(
  usuarioId: string,
  email: string,
  nichoId: number,
  plano: "padrao" | "sem_limite",
) {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${usuarioId}`, email });
  await db()
    .insert(account)
    .values({
      id: `${usuarioId}-credential`,
      issuer: "local:credential",
      accountId: usuarioId,
      providerId: "credential",
      userId: usuarioId,
      password: await hashPassword(SENHA),
    });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });

  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${usuarioId}`, nichoId, plano }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });

  return cliente;
}

async function escolherTemaEGerar(page: Page, tituloTema: string, rotuloBotao: string) {
  const cartao = page.getByRole("heading", { name: tituloTema });
  await expect(cartao).toBeVisible();
  await cartao.locator("../..").getByRole("button", { name: rotuloBotao }).click();

  await expect(page).toHaveURL(/\/hoje\/objetivo/);
  await page.getByRole("radio", { name: /gente me chamar para comprar/i }).click();
  await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
  await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
}

test.describe("plano por marca (V9b-0)", () => {
  let nichoId: number;

  test.beforeAll(async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-sem-limite", nome: "[teste] Sem limite" })
      .returning();
    nichoId = nicho.id;

    const temas: TemaDoDia[] = [
      { titulo: "tema sem limite 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema sem limite 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema sem limite 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
  });

  test("plano sem_limite: gera roteiro de dois temas diferentes e ve os dois cartoes, com os temas sempre visiveis", async ({
    page,
  }) => {
    await criarClienteComPlano("e2e-sem-limite-a", "e2e-sem-limite-a@exemplo.teste", nichoId, "sem_limite");
    await entrar(page, "e2e-sem-limite-a@exemplo.teste");

    // Os tres temas aparecem com "Escrever o roteiro" (nunca "Quero esse" ou "Trocar" neste plano).
    await expect(page.getByRole("heading", { name: "tema sem limite 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Quero esse" })).toHaveCount(0);

    await escolherTemaEGerar(page, "tema sem limite 1", "Escrever o roteiro");

    await page.goto("/hoje");
    await expect(page.getByText("Seus roteiros de hoje")).toBeVisible();
    // Ainda so um cartao: sem a contagem entre parenteses.
    await expect(page.getByText("Seus roteiros de hoje (2)")).toHaveCount(0);
    // Os tres temas continuam visiveis, mesmo com um roteiro ja gerado hoje.
    await expect(page.getByRole("heading", { name: "tema sem limite 2" })).toBeVisible();

    await escolherTemaEGerar(page, "tema sem limite 2", "Escrever o roteiro");

    await page.goto("/hoje");
    await expect(page.getByText("Seus roteiros de hoje (2)")).toBeVisible();
    await expect(page.getByRole("link", { name: "Modo gravação" })).toHaveCount(2);
    // Os temas continuam visiveis mesmo com dois roteiros ja gerados hoje.
    await expect(page.getByRole("heading", { name: "tema sem limite 3" })).toBeVisible();
  });

  test("plano padrao: continua vendo um cartao so, com 'ver os outros temas' e 'Trocar'", async ({ page }) => {
    await criarClienteComPlano("e2e-sem-limite-b", "e2e-sem-limite-b@exemplo.teste", nichoId, "padrao");
    await entrar(page, "e2e-sem-limite-b@exemplo.teste");

    await escolherTemaEGerar(page, "tema sem limite 1", "quero esse");

    await page.goto("/hoje");
    await expect(page.getByText("Seu roteiro de hoje está pronto")).toBeVisible();
    await expect(page.getByRole("link", { name: "Modo gravação" })).toHaveCount(1);

    await page.getByRole("button", { name: "Ver os outros temas de hoje" }).click();
    await expect(page.getByRole("button", { name: "Trocar" }).first()).toBeVisible();
    await expect(page.getByText("Trocar de tema escreve um roteiro novo")).toBeVisible();
  });
});
