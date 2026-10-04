/**
 * O plano é "quantos roteiros quiser por dia", para toda marca hoje (decisão do Gustavo de
 * 25/09/2026 e de 01/10/2026; revisão do Fable no PR #90: esconder o Reels mais antigo do dia era
 * regressão, quem prepara dois vídeos para o mesmo dia perdia um de vista). A Agenda (`/hoje`)
 * mostra todos os Reels do dia: o primeiro a gravar em destaque, os outros logo abaixo, em linhas
 * como as dos Stories. `clientes.plano` (`padrao`/`sem_limite`) não muda mais nada visível na
 * tela, nos dois planos: estes dois testes confirmam isso, gerando dois roteiros no mesmo dia e
 * vendo os dois na Agenda, com cada um dos dois valores do campo.
 *
 * Mesma lição de `temas-do-dia.spec.ts` e `roteiro.spec.ts`: grava briefing e tema do dia direto
 * no banco, e deixa só a geração do roteiro passar pelo navegador, contra o `AI_PROVIDER=mock` do
 * servidor. Nicho próprio ("e2e-sem-limite"), sem `resetarSchema` (o seed roda uma vez só, no
 * globalSetup).
 */
import { expect, test, type Page } from "@playwright/test";
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

/** E39a: os temas do dia ficam na rota "/criar/temas", igual para os dois planos. */
async function escolherTemaEGerar(page: Page, tituloTema: string) {
  await page.goto("/criar/temas");
  const cartao = page.getByRole("heading", { name: tituloTema });
  await expect(cartao).toBeVisible();
  await cartao.locator("../..").getByRole("button", { name: "Quero esse" }).click();

  await expect(page).toHaveURL(/\/criar\/objetivo/);
  // "Que muita gente veja" é uma das fichas do Reels (o formato não vem mais do objetivo, E49 PR 1);
  // este teste prova o destaque de Reels da Agenda.
  await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
  await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
  await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
}

test.describe("plano por marca (V9b-0)", () => {
  let nichoId: number;

  test.beforeAll(async () => {
    // Seguro para dois testes do mesmo describe caindo em workers diferentes (beforeAll roda por
    // worker, não uma vez só por arquivo; achado desta prova): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, "e2e-sem-limite"));
    if (jaExiste) {
      nichoId = jaExiste.id;
      return;
    }

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
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas }).onConflictDoNothing();
  });

  test("plano sem_limite: gera roteiro de dois temas diferentes no mesmo dia, os dois visiveis no Hoje", async ({
    page,
  }) => {
    await criarClienteComPlano("e2e-sem-limite-a", "e2e-sem-limite-a@exemplo.teste", nichoId, "sem_limite");
    await entrar(page, "e2e-sem-limite-a@exemplo.teste");

    await escolherTemaEGerar(page, "tema sem limite 1");

    // Primeiro Reels do dia: o destaque da Agenda.
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "tema sem limite 1" })).toBeVisible();

    // Os tres temas continuam visiveis, mesmo com um roteiro ja gerado hoje.
    await escolherTemaEGerar(page, "tema sem limite 2");

    // Revisão do Fable no PR #90: os dois Reels do dia ficam visiveis, o segundo numa linha
    // abaixo do destaque (nunca escondendo o primeiro).
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "tema sem limite 1" })).toBeVisible();
    await expect(page.getByText("tema sem limite 2")).toBeVisible();

    // Os temas continuam visiveis mesmo com dois roteiros ja gerados hoje.
    await page.goto("/criar/temas");
    await expect(page.getByRole("heading", { name: "tema sem limite 3" })).toBeVisible();
  });

  test("plano padrao: gerar dois roteiros no mesmo dia tambem mostra os dois no Hoje", async ({ page }) => {
    await criarClienteComPlano("e2e-sem-limite-b", "e2e-sem-limite-b@exemplo.teste", nichoId, "padrao");
    await entrar(page, "e2e-sem-limite-b@exemplo.teste");

    await escolherTemaEGerar(page, "tema sem limite 1");
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "tema sem limite 1" })).toBeVisible();

    // O plano "padrao" nao limita mais quantos Reels aparecem no mesmo dia (so o campo no banco
    // continua existindo; revisão do Fable no PR #90).
    await escolherTemaEGerar(page, "tema sem limite 2");
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "tema sem limite 1" })).toBeVisible();
    await expect(page.getByText("tema sem limite 2")).toBeVisible();

    await page.goto("/criar/temas");
    await expect(page.getByRole("heading", { name: "tema sem limite 3" })).toBeVisible();
  });
});
