/**
 * `/admin/viagem` pela tela (V10, item 1 e 2): o topo "o que está quebrado
 * agora" mostra o último job com erro, e a tabela mostra a contagem de
 * roteiros do dia para a marca do seed, com o ponto vermelho (pior estado
 * entre coleta e transcrição).
 *
 * Sem `resetarSchema` proprio (mesmo raciocinio de `admin-jobs.spec.ts`): o
 * seed roda uma vez no globalSetup; os dados deste arquivo usam a marca e o
 * nicho do seed ("dentistas"), com um `idExterno`/nome próprios para o job,
 * sem colidir com outro spec.
 */
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { clientes, execucoesJob, roteiros } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const HOJE = hojeISO();

test.describe("/admin/viagem", () => {
  test.beforeAll(async () => {
    const [cliente] = await db()
      .select({ id: clientes.id, nome: clientes.nome })
      .from(clientes)
      .where(eq(clientes.usuarioId, "seed-cliente-dentistas"));

    await db()
      .insert(execucoesJob)
      .values({
        nome: "coleta-youtube",
        status: "erro",
        erro: "e2e-admin-viagem: falha de exemplo",
        terminadoEm: new Date(),
      });

    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: HOJE,
        tema: "e2e-admin-viagem: tema de exemplo",
        origem: "sugerido",
        objetivo: "alcance",
        formato: "reels",
        conteudo: {
          titulo: "titulo",
          duracaoS: 30,
          gancho: "gancho",
          corpo: "corpo",
          fechamento: "fechamento",
          chamadaFinal: "chamada",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "no local",
          edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: false,
          forcaEvidencia: null,
        },
        status: "gerado",
      });
  });

  test("mostra o erro de job no topo e o roteiro do dia na tabela, filtra por marca", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
    await page.getByLabel("Senha").fill(SENHA_ADMIN);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);

    await page.goto("/admin/viagem");
    await expect(page.getByRole("heading", { name: "Viagem", exact: true })).toBeVisible();

    await expect(page.getByText("coleta-youtube: e2e-admin-viagem: falha de exemplo")).toBeVisible();

    const [cliente] = await db()
      .select({ nome: clientes.nome })
      .from(clientes)
      .where(eq(clientes.usuarioId, "seed-cliente-dentistas"));

    const cabecalhoMarca = page.locator("th", { hasText: cliente.nome });
    await expect(cabecalhoMarca).toBeVisible();

    const linhaHoje = page.locator("tbody tr").last();
    await expect(linhaHoje.getByText("1 roteiro", { exact: true })).toBeVisible();

    // V12, item 7: o detalhe da célula abre num toque (`<details>`), o `title` não funcionava no celular.
    const detalheCelula = linhaHoje.locator("details").first();
    await expect(detalheCelula.locator("pre")).toBeHidden();
    await detalheCelula.locator("summary").click();
    await expect(detalheCelula.locator("pre")).toContainText("coleta:");

    await page.getByLabel("marca").selectOption({ label: cliente.nome });
    await expect(page).toHaveURL(/marcaId=/);
    await expect(page.locator("thead th")).toHaveCount(2); // "dia" mais a marca escolhida, nenhuma outra coluna
  });
});
