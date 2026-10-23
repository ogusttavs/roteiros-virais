/**
 * O calendário de datas (E60): o Planejar marca o dia com o nome da data (feriado, data que vende, dia do ramo), nas três visões (Dia, Semana e Mês), e só mostra as datas gerais
 * mais as do ramo da marca. O Hoje e a tela de temas do Criar mostram a data de hoje ou a que chega nos próximos 7 dias; como isso depende do dia em que o teste roda, a prova
 * é que o cartão aparece quando (e só quando) a base tem uma data nesses dias, calculada pela mesma função pura que o servidor usa.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { datasDeHojeEProximas } from "../../src/config/datas";
import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const GERAL = { id: "e2e-datas-geral", email: "e2e-datas-geral@exemplo.teste", nome: "[teste] Datas geral" };
const DENTISTA = { id: "e2e-datas-dentista", email: "e2e-datas-dentista@exemplo.teste", nome: "[teste] Datas dentista" };

async function criarPessoa(pessoa: { id: string; email: string; nome: string }, nichoId: number) {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, pessoa.id));
  if (jaExiste) return;
  await db().insert(user).values({ id: pessoa.id, name: pessoa.nome, email: pessoa.email });
  await db()
    .insert(account)
    .values({ id: `${pessoa.id}-credential`, issuer: "local:credential", accountId: pessoa.id, providerId: "credential", userId: pessoa.id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: pessoa.id, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: pessoa.id, nome: pessoa.nome, nichoId }).returning();
  await db().insert(membrosMarca).values({ usuarioId: pessoa.id, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({
    clienteId: marca.id,
    completo: true,
    perfil: {
      fatos: {
        oQueVende: "serviços",
        preco: "a partir de R$ 100",
        clienteIdeal: "gente da cidade",
        medos: [],
        frasesDaFala: [],
        proibicoes: [],
        cenasFilmaveis: [],
        concorrentes: [],
        perfisAdmirados: [],
      },
      resumo: "negócio local",
      referencias: [],
    },
  });
}

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("calendário de datas", () => {
  test.beforeAll(async () => {
    const [semRamo] = await db().insert(nichos).values({ slug: "e2e-datas-sem-ramo", nome: "[teste] Datas sem ramo do catálogo" }).onConflictDoNothing().returning();
    const nichoGeral = semRamo ?? (await db().select().from(nichos).where(eq(nichos.slug, "e2e-datas-sem-ramo")))[0];
    const [odonto] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
    await criarPessoa(GERAL, nichoGeral.id);
    await criarPessoa(DENTISTA, odonto.id);
  });

  test("Mês: o dia 25 de dezembro mostra o Natal, no calendário e na lista do dia", async ({ page }) => {
    await entrar(page, GERAL.email);
    await page.goto("/planejamento?visao=mes&mes=2026-12&dia=2026-12-25");

    const doDia = page.locator("[data-datas-do-dia]");
    await expect(doDia).toContainText("Natal");
    await expect(doDia).toContainText("Feriado");
    await expect(page.getByRole("button", { name: /25 de dezembro.*Natal/i })).toBeVisible();
    // Um dia sem data não ganha nenhuma.
    await page.goto("/planejamento?visao=mes&mes=2026-12&dia=2026-12-10");
    await expect(page.locator("[data-datas-do-dia]")).toHaveCount(0);
  });

  test("Mês: a data do ramo aparece só para a marca do ramo (Dia do Cirurgião-Dentista, 25 de outubro)", async ({ page }) => {
    await entrar(page, DENTISTA.email);
    await page.goto("/planejamento?visao=mes&mes=2026-10&dia=2026-10-25");
    await expect(page.locator("[data-datas-do-dia]")).toContainText("Dia do Cirurgião-Dentista");
    await expect(page.locator("[data-datas-do-dia]")).toContainText("Data do seu ramo");
    // O Dia do Médico (18 de outubro) é de outro ramo: a clínica odontológica não o vê.
    await page.goto("/planejamento?visao=mes&mes=2026-10&dia=2026-10-18");
    await expect(page.locator("[data-datas-do-dia]")).toHaveCount(0);
  });

  test("Mês: quem não é do ramo não vê o Dia do Cirurgião-Dentista", async ({ page }) => {
    await entrar(page, GERAL.email);
    await page.goto("/planejamento?visao=mes&mes=2026-10&dia=2026-10-25");
    await expect(page.locator("[data-datas-do-dia]")).toHaveCount(0);
    await expect(page.getByText("Dia do Cirurgião-Dentista")).toHaveCount(0);
  });

  test("Dia: abrir 10 de maio de 2026 mostra o Dia das Mães com o selo de data que vende", async ({ page }) => {
    await entrar(page, GERAL.email);
    await page.goto("/planejamento?visao=dia&dia=2026-05-10");
    const doDia = page.locator("[data-datas-do-dia]");
    await expect(doDia).toContainText("Dia das Mães");
    await expect(doDia).toContainText("Data que vende");
  });

  test("Semana: a coluna do dia leva o nome da data, no celular e no computador", async ({ page }) => {
    await entrar(page, GERAL.email);
    for (const tamanho of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(tamanho);
      await page.goto("/planejamento?visao=semana&dia=2026-12-25");
      await expect(page.locator('[data-data-do-dia="2026-12-25"]')).toContainText("Natal");
    }
  });

  test("Hoje e Criar: o cartão da data aparece quando há data de hoje ou dos próximos 7 dias, e só então", async ({ page }) => {
    const esperadas = datasDeHojeEProximas(hojeISO(), ["odontologia"]);
    const quantas = esperadas.hoje.length + esperadas.proximas.length;
    await entrar(page, DENTISTA.email);

    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
    if (quantas > 0) {
      const cartao = page.locator('[data-datas="hoje"]');
      await expect(cartao).toBeVisible();
      const primeira = esperadas.hoje[0] ?? esperadas.proximas[0];
      await expect(cartao).toContainText(primeira.nome);
      await cartao.getByRole("button", { name: "Gravar sobre esta data" }).first().click();
      await expect(page).toHaveURL(/\/criar\/tema-livre\?tema=/);
      await expect(page.getByRole("textbox").first()).toHaveValue(new RegExp(primeira.nome));
    } else {
      await expect(page.locator('[data-datas="hoje"]')).toHaveCount(0);
    }

    await page.goto("/criar/temas");
    if (quantas > 0) {
      const sugestao = page.locator('[data-datas="sugestao"]');
      await expect(sugestao).toBeVisible();
      await expect(sugestao).toContainText("Fonte da data");
      await expect(sugestao).toContainText("não de uma pesquisa de vídeos");
    } else {
      await expect(page.locator('[data-datas="sugestao"]')).toHaveCount(0);
    }
  });
});
