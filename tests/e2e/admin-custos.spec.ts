/**
 * Custos e Rotinas pela tela (E46 PR 3): o teto que se troca ali mesmo, o fixo que se cadastra, edita e tira (sem apagar), e os cartões das rotinas com o detalhe. A prova de que
 * quem não é admin não entra está em `admin-protegido.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { configuracaoAdmin, custosExternos, custosFixos, execucoesJob, geracoesIA, nichos } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA = "ExemploSenha123";

async function entrarAdmin(page: Page): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

test.describe("custos e rotinas", () => {
  test.afterAll(async () => {
    await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, "teto_diario_brl"));
    await db().delete(custosFixos).where(eq(custosFixos.nome, "E2E Servidor de teste"));
    const [ramo] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, "e2e-custo-ramo"));
    if (ramo) {
      await db().delete(custosExternos).where(eq(custosExternos.ramoId, ramo.id));
      await db().delete(geracoesIA).where(eq(geracoesIA.ramoId, ramo.id));
      await db().delete(nichos).where(eq(nichos.id, ramo.id));
    }
  });

  test("Custos: o custo por ramo e o que se paga fora da IA aparecem, e as rotinas deixam rodar só um ramo", async ({ page }) => {
    const ontem = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const [ramo] = await db().insert(nichos).values({ slug: "e2e-custo-ramo", nome: "E2E Ramo de custo", termos: [] }).returning();
    await db().insert(geracoesIA).values({ tarefa: "modeloNicho", versaoPrompt: "0", modelo: "mock", entradas: {}, ramoId: ramo.id, custoUsd: "0.500000", criadoEm: ontem } as never);
    await db().insert(custosExternos).values([
      { fonte: "groq", custoUsd: "0.020000", unidades: "30.000", unidade: "minutos", origemDoCusto: "estimado", ramoId: ramo.id, criadoEm: ontem },
      { fonte: "apify", custoUsd: "0.040000", unidades: "200.000", unidade: "resultados", origemDoCusto: "api", ramoId: ramo.id, criadoEm: ontem },
    ]);

    await entrarAdmin(page);
    await page.goto("/admin/custos");
    const porRamo = page.locator('[data-bloco="por-ramo"]');
    const linhaDoRamo = porRamo.locator(`[data-ramo="${ramo.id}"]`);
    await expect(linhaDoRamo).toContainText("E2E Ramo de custo");
    await expect(linhaDoRamo).toContainText("IA R$ 2,75, fora da IA R$ 0,33, inclui valores estimados");
    await expect(page.locator('[data-contador="30dias"]')).toContainText("inclui valores estimados");
    const fora = page.locator('[data-bloco="fora-da-ia"]');
    await expect(fora.locator('[data-fonte="groq"]')).toContainText("30 minutos de áudio");
    await expect(fora.locator('[data-fonte="groq"]')).toContainText("valor estimado pelo preço de tabela");
    await expect(fora.locator('[data-fonte="apify"]')).toContainText("200 resultados");
    await expect(fora.locator('[data-fonte="apify"]')).toContainText("valor que o próprio serviço informou");

    await page.goto("/admin/jobs");
    const rotina = page.locator('[data-rotina="transcrever"]');
    await rotina.getByText("Ver o detalhe").click();
    await expect(rotina.locator("[data-rodar-ramo]").first()).toBeVisible();
    await expect(rotina.getByRole("button", { name: "Rodar só este ramo" }).first()).toBeDisabled();
    await rotina.getByLabel("Escolha o ramo").first().selectOption({ label: "E2E Ramo de custo" });
    await expect(rotina.getByRole("button", { name: "Rodar só este ramo" }).first()).toBeEnabled();
  });

  test("Custos: a navegação leva a eles, com o câmbio escrito, e o teto se troca ali mesmo", async ({ page }) => {
    await entrarAdmin(page);
    await page.getByRole("navigation", { name: "Seções do admin" }).getByRole("link", { name: "Custos", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/custos$/);
    await expect(page.getByRole("heading", { name: "Custos", level: 1 })).toBeVisible();
    await expect(page.getByText("Em reais, com o dólar a R$ 5,50 (câmbio de 2 de outubro de 2026).")).toBeVisible();
    for (const contador of ["hoje", "7dias", "30dias", "por-roteiro"]) await expect(page.locator(`[data-contador="${contador}"]`)).toBeVisible();

    await page.getByRole("button", { name: "Trocar o teto" }).click();
    await page.getByLabel("Teto por dia, em reais").fill("37,5");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.locator("[data-teto-linha]")).toContainText("de R$ 37,50 por dia");
    await expect.poll(async () => (await db().select().from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, "teto_diario_brl")))[0]?.valor).toBe("37.5");

    // Valor que não presta: a frase de erro, e o teto continua o de antes.
    await page.getByRole("button", { name: "Trocar o teto" }).click();
    await page.getByLabel("Teto por dia, em reais").fill("0");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("[data-teto-linha]")).toContainText("de R$ 37,50 por dia");
  });

  test("Custos: adicionar, editar e tirar um fixo; tirar não apaga a linha", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto("/admin/custos");
    const fixos = page.locator('[data-bloco="fixos"]');
    await fixos.getByRole("button", { name: "Adicionar um fixo" }).click();
    await fixos.getByLabel("O quê").fill("E2E Servidor de teste");
    await fixos.getByLabel("Valor", { exact: true }).fill("109");
    await fixos.getByLabel("Quando cobra").fill("todo dia 5");
    await fixos.getByRole("button", { name: "Salvar" }).click();
    const linha = fixos.locator("tr", { hasText: "E2E Servidor de teste" });
    await expect(linha).toContainText("R$ 109,00 por mês");
    await expect(linha).toContainText("todo dia 5");
    await expect(fixos).toContainText("Por mês, com o dólar de hoje R$ 109,00");

    await linha.getByRole("button", { name: "Editar E2E Servidor de teste" }).click();
    await fixos.getByLabel("Moeda").selectOption("usd");
    await fixos.getByLabel("Valor", { exact: true }).fill("10");
    await fixos.getByRole("button", { name: "Salvar" }).click();
    await expect(fixos.locator("tr", { hasText: "E2E Servidor de teste" })).toContainText("R$ 55,00");

    // O Início passa a ler os fixos cadastrados, e não o valor da apresentação.
    await page.goto("/admin");
    await expect(page.locator('[data-dinheiro="30dias"]')).not.toContainText("R$ 1.639,00 de fixos");
    await page.goto("/admin/custos");
    await fixos.locator("tr", { hasText: "E2E Servidor de teste" }).getByRole("button", { name: "Tirar E2E Servidor de teste" }).click();
    await expect(page.getByText("O que ele já custou continua nos meses que passaram.")).toBeVisible();
    await page.getByRole("button", { name: "Tirar", exact: true }).click();
    await expect(fixos.locator("tr", { hasText: "E2E Servidor de teste" })).toHaveCount(0);
    const [linhaNoBanco] = await db().select().from(custosFixos).where(eq(custosFixos.nome, "E2E Servidor de teste"));
    expect(linhaNoBanco.ativo).toBe(false);
    expect(linhaNoBanco.tiradoEm).not.toBeNull();
  });

  test("Rotinas: o cartão do grupo em que um job falhou e outro deu certo diz qual falhou, quando e por quê, e o resultado é o do que falhou", async ({ page }) => {
    const agora = Date.now();
    const [falhou, deuCerto] = await db()
      .insert(execucoesJob)
      .values([
        { nome: "coleta-meio-dia", status: "erro", iniciadoEm: new Date(agora - 3 * 60 * 60 * 1000), terminadoEm: new Date(agora - 3 * 60 * 60 * 1000 + 5000), erro: "meta api indisponivel (codigo 4): (#4) Application request limit reached" },
        { nome: "coleta-apify", status: "ok", iniciadoEm: new Date(agora - 60 * 60 * 1000), terminadoEm: new Date(agora - 60 * 60 * 1000 + 49_900) },
      ])
      .returning({ id: execucoesJob.id });
    try {
      await entrarAdmin(page);
      await page.goto("/admin/jobs");
      const cartao = page.locator('[data-rotina="buscar"]');
      await expect(cartao).toHaveAttribute("data-estado", "erro");
      const resultado = cartao.locator("[data-resultado]");
      await expect(resultado).toHaveAttribute("data-resultado", "falhou");
      await expect(resultado).toContainText("A coleta do meio-dia falhou");
      await expect(resultado).toContainText("O limite da Meta (Instagram) foi atingido; a rotina continua na hora seguinte.");
      await expect(resultado).not.toContainText("deu certo");
    } finally {
      await db().delete(execucoesJob).where(eq(execucoesJob.id, falhou.id));
      await db().delete(execucoesJob).where(eq(execucoesJob.id, deuCerto.id));
    }
  });

  test("Rotinas: a madrugada por ramo e um cartão por rotina, com o detalhe técnico dentro", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto("/admin/jobs");
    await expect(page.getByRole("heading", { name: "Rotinas", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A madrugada de hoje" })).toBeVisible();
    await expect(page.locator("[data-ramo]").first()).toBeVisible();
    for (const rotina of ["buscar", "transcrever", "temas", "lembrete"]) await expect(page.locator(`[data-rotina="${rotina}"]`)).toBeVisible();
    await expect(page.locator('[data-rotina="transcrever"]')).toContainText("Escreve o que é dito nos vídeos");
    await expect(page.locator('[data-rotina="temas"]')).toContainText("todo dia às");
    const detalhe = page.locator('[data-rotina="temas"]');
    await detalhe.getByText("Ver o detalhe").click();
    await expect(detalhe.locator('[data-fila="temas-do-dia"]')).toContainText("Nome no sistema: temas-do-dia");
    for (const largura of [1280, 1024, 390]) {
      await page.setViewportSize({ width: largura, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
