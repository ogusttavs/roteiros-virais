/**
 * "Tema do dia só para quem usa" (decisão do Gustavo, 05/10/2026), a parte da tela: quem abre os temas de hoje num ramo SEM tema (a madrugada não gerou: ninguém tinha gerado roteiro em
 * 3 dias) vê a espera ("Estamos escolhendo os temas de hoje para você") e o pedido do tema entra na fila com `aoAbrir`, sem a madrugada; quando o tema nasce, a tela se atualiza
 * sozinha e mostra os três cartões. Não há worker no e2e: o teste é quem faz o papel dele, gravando o tema.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, temasDia, user, videos, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-tema-na-hora@exemplo.teste";
let nichoId: number;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("o tema nasce na hora para quem abre a tela", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, "e2e-tema-na-hora"));
    if (existente) {
      nichoId = existente.id;
      await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
      return;
    }
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-tema-na-hora", nome: "[teste] Tema na hora" }).returning();
    nichoId = nicho.id;
    // O ramo já foi lido (tem vídeo analisado): sem isto a tela diria "estamos lendo os vídeos", e não pediria o tema.
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: "e2e-tema-na-hora-video",
      url: "https://exemplo.invalido/e2e-tema-na-hora",
      nichoId,
      titulo: "video do ramo",
      analise: { assunto: "x", gancho: "x", estrutura: "x", fechamento: "x", chamadaFinal: "x", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
    });
    await db().insert(user).values({ id: "e2e-tema-na-hora", name: "[teste] Tema na hora", email: EMAIL });
    await db().insert(account).values({ id: "e2e-tema-na-hora-credential", issuer: "local:credential", accountId: "e2e-tema-na-hora", providerId: "credential", userId: "e2e-tema-na-hora", password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-tema-na-hora", aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: "e2e-tema-na-hora", nome: "[teste] Tema na hora", nichoId }).returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-tema-na-hora", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: marca.id, completo: true });
  });

  test("sem tema de hoje: mostra a espera, enfileira o tema (aoAbrir, uma vez só) e, quando o tema nasce, a tela se atualiza sozinha", async ({ page }) => {
    await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
    await db().execute(sql`delete from pgboss.job where name = 'temas-do-dia' and (data ->> 'nichoId')::int = ${nichoId}`);

    await entrar(page);
    await page.goto("/criar/temas");
    const espera = page.locator("[data-gerando-temas]");
    await expect(espera).toBeVisible();
    await expect(espera).toContainText("Estamos escolhendo os temas de hoje para você");
    await expect(page.getByText("Hoje não saiu tema para o seu setor")).toHaveCount(0);

    // O pedido entrou na fila com `aoAbrir`, e recarregar não empilha outro.
    await page.reload();
    await expect(page.locator("[data-gerando-temas]")).toBeVisible();
    const pedidos = await db().execute(sql`select data from pgboss.job where name = 'temas-do-dia' and (data ->> 'nichoId')::int = ${nichoId}`);
    expect(pedidos.rows).toHaveLength(1);
    expect((pedidos.rows[0] as { data: { aoAbrir: boolean } }).data.aoAbrir).toBe(true);

    // O "worker" termina: o tema nasce, e a tela troca a espera pelos três cartões sem ninguém mexer.
    const temas: TemaDoDia[] = [
      { titulo: "tema que nasceu na hora 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema que nasceu na hora 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema que nasceu na hora 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
    await db().execute(sql`delete from pgboss.job where name = 'temas-do-dia' and (data ->> 'nichoId')::int = ${nichoId}`);
    await expect(page.getByText("tema que nasceu na hora 1")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-gerando-temas]")).toHaveCount(0);
  });

  test("o ramo que já tentou hoje (a linha do dia, mesmo vazia) não pede de novo: mostra o aviso de sempre", async ({ page }) => {
    await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [] });
    await entrar(page);
    await page.goto("/criar/temas");
    await expect(page.locator("[data-gerando-temas]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Escrever o meu assunto|escrever o meu assunto/i })).toBeVisible();
  });
});
