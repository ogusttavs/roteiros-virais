/**
 * O assunto do momento no admin (E55 PR 2, parte c): a lista de Ramos diz, embaixo da última leitura, "1 do momento: <assunto>" para o ramo que ganhou tema do momento hoje (e nada para o que não
 * ganhou), e a rotina que monta os temas do dia termina a frase com quantos ramos têm tema do momento.
 *
 * Um ramo só deste arquivo, com os temas de hoje e a rodada de tendências dele; a rodada sai no fim (a lista de agora é a rodada mais recente).
 */
import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";

import { db } from "../../src/db";
import { execucoesJob, nichos, temasDia, tendenciasBrasil, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";
const PREFIXO = "E2E admin em alta";

test.afterAll(async () => {
  await db().delete(tendenciasBrasil).where(like(tendenciasBrasil.assunto, `${PREFIXO}%`));
});

test.describe("o assunto do momento no admin", () => {
  test("Ramos diz qual é o assunto do momento do ramo, e Rotinas diz quantos ramos o têm", async ({ page }) => {
    const sufixo = `${test.info().testId}-r${test.info().retry}`;
    const assunto = `${PREFIXO} Frente fria ${sufixo}`;
    const chave = assunto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
    const [comMomento] = await db().insert(nichos).values({ slug: `e2e-admin-alta-${sufixo}`, nome: `Ramo com momento ${sufixo}`, termos: [] }).returning();
    const [semMomento] = await db().insert(nichos).values({ slug: `e2e-admin-sem-${sufixo}`, nome: `Ramo sem momento ${sufixo}`, termos: [] }).returning();
    const temaComum: TemaDoDia = { titulo: "Um tema comum", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
    const temaDoMomento: TemaDoDia = {
      ...temaComum,
      titulo: "O mofo que a frente fria traz",
      doMomento: { chave, assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 9 },
    };
    await db().insert(temasDia).values({ nichoId: comMomento.id, data: hojeISO(), temas: [temaComum, temaDoMomento] });
    await db().insert(temasDia).values({ nichoId: semMomento.id, data: hojeISO(), temas: [temaComum] });
    await db()
      .insert(tendenciasBrasil)
      .values({ coletadaEm: new Date(Date.now() - 60_000), assunto, chave, termos: [assunto], fontes: [{ fonte: "google", titulo: assunto, url: null, trafego: "2000+", posicao: 1 }], posicao: 1, sensivel: false });
    await db().insert(execucoesJob).values({ nome: "temas-do-dia", status: "ok", terminadoEm: new Date(), resumo: { nichos: 2, semUso: 0 } });

    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
    await page.getByLabel("Senha").fill(SENHA_ADMIN);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);

    await page.goto("/admin/nichos");
    const linhaDoRamo = page.getByRole("row").filter({ hasText: `Ramo com momento ${sufixo}` });
    await expect(linhaDoRamo.locator("[data-do-momento]")).toContainText(`1 do momento: ${assunto}`);
    await expect(page.getByRole("row").filter({ hasText: `Ramo sem momento ${sufixo}` }).locator("[data-do-momento]")).toHaveCount(0);

    await page.goto("/admin/jobs");
    await expect(page.locator('[data-rotina="temas"]')).toContainText(/Hoje, \d+ ramos? com tema do momento\./);
  });
});
