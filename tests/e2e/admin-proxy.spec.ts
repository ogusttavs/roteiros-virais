/**
 * Hotfix do proxy (09/10/2026): o proxy do YouTube, cobrado por gigabyte, acabou, e a madrugada seguia tentando em silêncio. O admin diz isso em três lugares: o Início ("o proxy do YouTube
 * está sem tráfego desde <dia>", enquanto a última noite que tentou baixar pelo proxy tiver parado por ele), o cartão da rotina "Transcrever", e em Custos o tráfego baixado, em dólar
 * estimado (US$ 1 por GB). Sem `resetarSchema` próprio: as linhas deste arquivo (uma execução do `transcrever` e dois custos) são apagadas no fim, para o Início dos outros
 * arquivos não carregar um aviso que não é deles.
 */
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { custosExternos, execucoesJob } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA = "ExemploSenha123";

async function entrarAdmin(page: Page): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

const DIA_MS = 24 * 60 * 60 * 1000;
/** "3 de outubro": como o admin escreve o dia (no fuso do Brasil). */
function diaDoMes(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(d);
}

test.describe("o proxy do YouTube no admin", () => {
  const desde = new Date(Date.now() - 3 * DIA_MS);
  const idsDasExecucoes: number[] = [];
  const idsDosCustos: number[] = [];

  test.beforeAll(async () => {
    // As noites seguidas em que o proxy parou: a mais antiga anotou o instante, e o "desde" do admin é esse dia.
    const [antiga, recente] = await db()
      .insert(execucoesJob)
      .values([
        { nome: "transcrever", status: "ok", iniciadoEm: new Date(desde.getTime() + 60_000), terminadoEm: new Date(desde.getTime() + 120_000), resumo: { youtubePausado: true, youtubePausadoMotivo: "proxy sem trafego", proxyPausadoDesde: desde.toISOString(), falhasPorProxy: 1 } },
        { nome: "transcrever", status: "ok", iniciadoEm: new Date(Date.now() - 60_000), terminadoEm: new Date(), resumo: { youtubePausado: true, youtubePausadoMotivo: "proxy sem trafego", proxyPausadoDesde: new Date(Date.now() - 90_000).toISOString(), falhasPorProxy: 1 } },
      ])
      .returning();
    idsDasExecucoes.push(antiga.id, recente.id);
    // Os 30 dias de Custos vão até ontem (hoje fica à parte): o gasto é de ontem.
    const ontem = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const [custo] = await db()
      .insert(custosExternos)
      .values({ fonte: "proxy", custoUsd: "1.500000", unidades: "1500.000", unidade: "megabytes", origemDoCusto: "estimado", execucaoId: recente.id, criadoEm: ontem })
      .returning();
    idsDosCustos.push(custo.id);
  });

  test.afterAll(async () => {
    for (const id of idsDosCustos) await db().delete(custosExternos).where(eq(custosExternos.id, id));
    for (const id of idsDasExecucoes) await db().delete(execucoesJob).where(eq(execucoesJob.id, id));
  });

  test("o Início pede atenção para o proxy sem tráfego, desde o dia em que parou, e o cartão da rotina diz o mesmo", async ({ page }) => {
    await entrarAdmin(page);

    const item = page.locator('[data-atencao="proxy"]');
    await expect(item).toBeVisible();
    await expect(item).toContainText("O proxy do YouTube está sem tráfego");
    await expect(item).toContainText(`desde ${diaDoMes(desde)}`);
    await expect(item).toContainText("recarregue o pacote no DataImpulse");

    await page.goto("/admin/jobs");
    await expect(page.locator('[data-rotina="transcrever"]')).toContainText(`O proxy do YouTube está sem tráfego desde ${diaDoMes(desde)}: o YouTube e o TikTok esperaram a noite seguinte.`);
  });

  test("Custos: o tráfego do proxy aparece em Fora da IA, em gigabytes e em dólar estimado, com o preço datado na nota", async ({ page }) => {
    await entrarAdmin(page);
    await page.goto("/admin/custos");

    const linha = page.locator('[data-bloco="fora-da-ia"] [data-fonte="proxy"]');
    await expect(linha).toContainText("Tráfego do proxy do YouTube");
    await expect(linha).toContainText("1,5 GB baixados");
    await expect(linha).toContainText("valor estimado pelo preço de tabela");
    await expect(page.locator('[data-bloco="fora-da-ia"]')).toContainText("Proxy do YouTube: US$ 1 por gigabyte");
  });

  test("uma noite que baixou pelo proxy com sucesso apaga o aviso (ele voltou)", async ({ page }) => {
    const [boa] = await db()
      .insert(execucoesJob)
      .values({ nome: "transcrever", status: "ok", terminadoEm: new Date(), resumo: { youtubePausado: false, sucessos: { youtube: 2, tiktok: 0, instagram: 0 } } })
      .returning();
    idsDasExecucoes.push(boa.id);

    await entrarAdmin(page);
    await expect(page.locator('[data-bloco="estado"]')).toBeVisible();
    await expect(page.locator('[data-atencao="proxy"]')).toHaveCount(0);
  });
});
