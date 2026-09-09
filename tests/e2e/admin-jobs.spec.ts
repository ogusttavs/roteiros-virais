/**
 * `/admin/jobs` pela tela (E6 parte 3, terceira rodada, item 5): as colunas
 * novas de coleta paga (devolvidos, consumidos, novos, fora da curva, taxa
 * de acerto) aparecem numa execucao de `coleta-apify` e ficam em branco
 * ("-") numa execucao de outro job, que nunca paga o Apify por resultado.
 *
 * Sem `resetarSchema` proprio (mesmo raciocinio de `temas-do-dia.spec.ts`):
 * o seed roda uma vez no globalSetup; a execucao e o video deste arquivo
 * usam um `idExterno`/nome proprios, sem colidir com outro spec.
 */
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { contas, execucoesJob, nichos, videos } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";

test.describe("admin de jobs, colunas de coleta paga", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
    const [conta] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "e2e-admin-jobs", nichoId: nicho.id })
      .returning();

    const [execucao] = await db()
      .insert(execucoesJob)
      .values({
        nome: "coleta-apify",
        status: "ok",
        terminadoEm: new Date(),
        resumo: { resultadosDevolvidos: 40, resultadosConsumidos: 30, videosNovos: 4 },
      })
      .returning();

    await db()
      .insert(videos)
      .values([
        {
          plataforma: "tiktok",
          idExterno: "e2e-admin-jobs-acerto",
          url: "https://exemplo.invalido/e2e-admin-jobs-acerto",
          contaId: conta.id,
          nichoId: nicho.id,
          foraDaCurva: "2.0",
          execucaoId: execucao.id,
        },
        {
          plataforma: "tiktok",
          idExterno: "e2e-admin-jobs-sem-acerto",
          url: "https://exemplo.invalido/e2e-admin-jobs-sem-acerto",
          contaId: conta.id,
          nichoId: nicho.id,
          foraDaCurva: "1.0",
          execucaoId: execucao.id,
        },
      ]);

    await db()
      .insert(execucoesJob)
      .values({
        nome: "vigilancia",
        status: "ok",
        terminadoEm: new Date(),
        resumo: { contasAvaliadas: 10, contasVigiadas: 5 },
      });
  });

  test("mostra devolvidos, consumidos, novos, fora da curva e taxa numa coleta paga; em branco num job que nao paga por resultado", async ({
    page,
  }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
    await page.getByLabel("Senha").fill(SENHA_ADMIN);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/clientes/);

    await page.goto("/admin/jobs");
    await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();

    const cabecalho = page.locator("thead");
    await expect(cabecalho.getByText("devolvidos", { exact: true })).toBeVisible();
    await expect(cabecalho.getByText("consumidos", { exact: true })).toBeVisible();
    await expect(cabecalho.getByText("novos", { exact: true })).toBeVisible();
    await expect(cabecalho.getByText("fora da curva", { exact: true })).toBeVisible();
    await expect(cabecalho.getByText("taxa de acerto", { exact: true })).toBeVisible();

    const linhaApify = page.locator("tbody tr", { has: page.getByText("coleta-apify", { exact: true }) }).first();
    await expect(linhaApify.locator("td").nth(4)).toHaveText("40"); // devolvidos
    await expect(linhaApify.locator("td").nth(5)).toHaveText("30"); // consumidos
    await expect(linhaApify.locator("td").nth(6)).toHaveText("4"); // novos
    await expect(linhaApify.locator("td").nth(7)).toHaveText("1"); // fora da curva (so o video de 2.0)
    await expect(linhaApify.locator("td").nth(8)).toHaveText("3%"); // 1/30

    const linhaVigilancia = page.locator("tbody tr", { has: page.getByText("vigilancia", { exact: true }) }).first();
    for (const indice of [4, 5, 6, 7, 8]) {
      await expect(linhaVigilancia.locator("td").nth(indice)).toHaveText("-");
    }
  });
});
