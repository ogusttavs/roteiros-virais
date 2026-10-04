/**
 * `/admin/jobs` (as Rotinas, E46 PR 3; antes a tabela da E6 parte 3, item 5): as colunas
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

test.describe("admin de rotinas, números da coleta paga", () => {
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
    await expect(page).toHaveURL(/\/admin\/?$/);

    await page.goto("/admin/jobs");
    await expect(page.getByRole("heading", { name: "Rotinas", exact: true })).toBeVisible();

    // As Rotinas (E46 PR 3): o desenho trocou a tabela por cartões; os números da coleta paga ficam no detalhe da rotina "Buscar vídeos novos".
    const buscar = page.locator('[data-rotina="buscar"]');
    await expect(buscar).toContainText("deu certo");
    await buscar.getByText("Ver o detalhe").click();
    const apify = buscar.locator('[data-fila="coleta-apify"]');
    await expect(apify).toContainText("devolvidos 40, consumidos 30, novos 4, fora da curva 1, taxa de acerto 3%");

    // Uma fila que nunca paga por resultado não mostra taxa nenhuma.
    const pontuar = page.locator('[data-rotina="pontuar"]');
    await pontuar.getByText("Ver o detalhe").click();
    await expect(pontuar.locator('[data-fila="vigilancia"]')).not.toContainText("taxa de acerto");
    await expect(pontuar.locator('[data-fila="vigilancia"]')).toContainText("Nome no sistema: vigilancia");
  });
});
