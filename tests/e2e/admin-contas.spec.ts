/**
 * O admin de contas (E46 PR 1), pela tela: o Início com os números que batem com o banco, a lista de Contas (filtros, busca por conta e por pessoa, uma pessoa em duas
 * contas) e a página da conta em blocos (trocar o ramo com o aviso, o tipo com o aviso, os roteiros por dia, o público), com o registro das trocas. A prova de que quem não
 * é admin não entra está em `admin-protegido.spec.ts` (o corpo da resposta, sem seguir o redirecionamento).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { count, eq, gte, sql } from "drizzle-orm";

import { db } from "../../src/db";
import { account, alteracoesDoAdmin, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA = "ExemploSenha123";
const PESSOA_ID = "e2e-contas-paula";
const PESSOA_EMAIL = "paula-e2e-contas@exemplo.teste";

let contaUm: number;
let contaDois: number;

async function entrarAdmin(page: Page): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

test.describe("admin de contas", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).limit(1);
    await db().delete(user).where(eq(user.id, PESSOA_ID));
    await db().insert(user).values({ id: PESSOA_ID, name: "Paula Mendes E2E", email: PESSOA_EMAIL });
    await db().insert(account).values({ id: `${PESSOA_ID}-c`, issuer: "local:credential", accountId: PESSOA_ID, providerId: "credential", userId: PESSOA_ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: PESSOA_ID, aceitouTermosEm: new Date() });
    const [um] = await db().insert(clientes).values({ nome: "[teste e2e] Conta Um das Contas", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" }).returning();
    const [dois] = await db().insert(clientes).values({ nome: "[teste e2e] Conta Dois das Contas", nichoId: nicho.id, tipo: "pessoa", alcance: "local", regiao: "Campinas e região" }).returning();
    contaUm = um.id;
    contaDois = dois.id;
    await db().insert(membrosMarca).values([
      { usuarioId: PESSOA_ID, clienteId: contaUm, papel: "dono" },
      { usuarioId: PESSOA_ID, clienteId: contaDois, papel: "membro" },
    ]);
  });

  test("Início: abre depois do login, com a navegação nova, e os números batem com o banco", async ({ page }) => {
    await entrarAdmin(page);
    await expect(page.getByRole("heading", { name: "Início", exact: true, level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Seções do admin" });
    for (const nome of ["Início", "Contas", "Ramos", "Rotinas", "Gerações"]) await expect(nav.getByRole("link", { name: nome, exact: true })).toBeVisible();

    const [{ total: ativas }] = await db().select({ total: count() }).from(clientes).where(eq(clientes.ativo, true));
    await expect(page.locator('[data-bloco="contas"] [data-numero="ativas"] dd')).toHaveText(String(ativas));

    const desde = hojeISO(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
    const [{ total: escritos }] = await db().select({ total: count() }).from(roteiros).where(gte(roteiros.data, desde));
    await expect(page.locator('[data-bloco="produto"] [data-numero="escritos"] dd')).toHaveText(String(escritos));

    await expect(page.locator('[data-bloco="dinheiro"]')).toContainText("Em reais, com o dólar a R$ 5,50 (câmbio de 2 de outubro de 2026).");
    await expect(page.locator('[data-bloco="dinheiro"] [data-dinheiro="30dias"]')).toContainText("R$ 1.639,00 de fixos");
    await expect(page.locator('[data-bloco="dinheiro"]')).toContainText("Ainda sem cobrança");
    await expect(page.getByRole("heading", { name: "A madrugada" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Os últimos erros" })).toBeVisible();
    // Sem rolagem para os lados em nenhum tamanho, o admin só precisa não quebrar.
    for (const largura of [1280, 1024, 390]) {
      await page.setViewportSize({ width: largura, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test("Contas: filtros, busca por conta e por pessoa, e uma pessoa em duas contas", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto("/admin/clientes");
    await expect(page.getByRole("heading", { name: "Contas", exact: true, level: 1 })).toBeVisible();
    const linhaUm = page.locator(`tr[data-conta="${contaUm}"]`);
    const linhaDois = page.locator(`tr[data-conta="${contaDois}"]`);
    await expect(linhaUm).toContainText("Paula Mendes E2E");
    await expect(linhaUm.locator("[data-semana]")).toHaveAttribute("aria-label", /Últimos 7 dias, do mais antigo ao de hoje: .+: nada/);
    await expect(linhaDois).toContainText("pessoal");
    await expect(linhaUm).toContainText("empresa");

    // Filtro: as duas nunca foram abertas por ninguém, então estão em "Não entrou" e em "Parou", e não em "Usando".
    const naoEntrou = page.getByRole("button", { name: /Não entrou/ });
    await naoEntrou.click();
    await expect(naoEntrou).toHaveAttribute("aria-pressed", "true");
    await expect(linhaUm).toBeVisible();
    await page.getByRole("button", { name: /Usando/ }).click();
    await expect(linhaUm).toHaveCount(0);
    await page.getByRole("button", { name: /Todas/ }).click();
    await expect(linhaUm).toBeVisible();

    // Busca por pessoa (sem acento): as duas contas dela, e a linha que diz que ela entra em 2.
    const busca = page.getByLabel("Buscar por conta ou pessoa");
    await busca.fill("paula mendes");
    await expect(linhaUm).toBeVisible();
    await expect(linhaDois).toBeVisible();
    await expect(page.locator(`[data-pessoa-em-varias="${PESSOA_EMAIL}"]`)).toContainText("entra em 2 contas");

    // Busca por conta, só ela; e a que não existe.
    await busca.fill("conta dois das contas");
    await expect(linhaDois).toBeVisible();
    await expect(linhaUm).toHaveCount(0);
    await busca.fill("clinica estrela inexistente");
    await expect(page.getByText('Nenhuma conta ou pessoa com "clinica estrela inexistente"')).toBeVisible();
  });

  test("Contas: ?filtro=parou abre já filtrada (o Início aponta para ela)", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto("/admin/clientes?filtro=parou");
    await expect(page.getByRole("button", { name: /Parou/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("a conta em blocos: trocar o ramo mostra o aviso, mantém o briefing e os roteiros, e deixa registro", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto(`/admin/clientes/${contaUm}`);
    for (const bloco of ["identidade", "briefing", "acesso", "ajustes", "uso"]) await expect(page.locator(`[data-bloco="${bloco}"]`)).toBeVisible();

    await page.getByRole("button", { name: "Trocar ramo" }).click();
    await page.getByRole("combobox").first().fill("pet");
    await page.getByRole("option").first().click();
    await expect(page.locator('[data-aviso="ramo"]')).toContainText("Ao trocar, a base de vídeos e os temas passam a ser os do ramo novo, a partir da próxima madrugada. O briefing e os roteiros continuam.");
    const [antes] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, contaUm));
    await page.getByRole("button", { name: /^Trocar para / }).click();
    await expect(page.locator('[data-campo="ramo"]').getByText("salvo agora")).toBeVisible();
    await expect.poll(async () => (await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, contaUm)))[0].nichoId).not.toBe(antes.nichoId);
    await expect.poll(async () => (await db().select().from(alteracoesDoAdmin).where(eq(alteracoesDoAdmin.clienteId, contaUm))).filter((a) => a.campo === "ramo").length).toBe(1);
    await page.reload();
    await expect(page.locator("[data-registro]")).toContainText("Ramo: de");
  });

  test("trocar o tipo avisa que o briefing recomeça, e só a confirmação troca", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto(`/admin/clientes/${contaUm}`);
    await page.getByRole("button", { name: "Trocar tipo" }).click();
    await page.getByRole("radio", { name: "Pessoal" }).click();
    await expect(page.locator('[data-aviso="tipo"]')).toContainText("as perguntas do briefing mudam");
    // Cancelar não troca nada.
    await page.getByRole("button", { name: "Cancelar" }).first().click();
    expect((await db().select({ tipo: clientes.tipo }).from(clientes).where(eq(clientes.id, contaUm)))[0].tipo).toBe("negocio");
    await page.getByRole("button", { name: "Trocar tipo" }).click();
    await page.getByRole("radio", { name: "Pessoal" }).click();
    await page.getByRole("button", { name: "Trocar para Pessoal" }).click();
    await expect(page.locator('[data-campo="tipo"]').getByText("salvo agora")).toBeVisible();
    await expect.poll(async () => (await db().select({ tipo: clientes.tipo }).from(clientes).where(eq(clientes.id, contaUm)))[0].tipo).toBe("pessoa");
  });

  test("trocar o público (cidade ou região) e os roteiros por dia valem e ficam no registro", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto(`/admin/clientes/${contaDois}`);
    await page.getByRole("button", { name: "Trocar público" }).click();
    await page.getByRole("radio", { name: "Brasil todo" }).click();
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.locator('[data-campo="publico"]')).toContainText("Brasil todo");
    await expect.poll(async () => (await db().select({ a: clientes.alcance }).from(clientes).where(eq(clientes.id, contaDois)))[0].a).toBe("brasil");

    // Local sem a cidade: a frase de erro, e o público continua o de antes.
    await page.getByRole("button", { name: "Trocar público" }).click();
    await page.getByRole("radio", { name: "Uma cidade ou região" }).click();
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect((await db().select({ a: clientes.alcance }).from(clientes).where(eq(clientes.id, contaDois)))[0].a).toBe("brasil");
    await page.getByRole("button", { name: "Cancelar" }).first().click();

    // Roteiros por dia: a conta tem o interruptor de sempre, agora no bloco Ajustes.
    await page.getByLabel("roteiros por dia").selectOption("sem_limite");
    await expect.poll(async () => (await db().select({ p: clientes.plano }).from(clientes).where(eq(clientes.id, contaDois)))[0].p).toBe("sem_limite");
    await expect.poll(async () => (await db().select().from(alteracoesDoAdmin).where(eq(alteracoesDoAdmin.clienteId, contaDois))).map((a) => a.campo).sort()).toEqual(["publico", "roteiros_por_dia"]);
    expect(await db().select({ n: sql<number>`count(*)::int` }).from(alteracoesDoAdmin).where(eq(alteracoesDoAdmin.clienteId, contaUm))).toBeDefined();
  });
});
