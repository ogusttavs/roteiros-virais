/**
 * Revisão do PR #62 (V11), item 2: em `ObjetivoTela`, "Voltar depois" navegava
 * para o Hoje, mas a transição continuava rodando; quando `gerarRoteiroAction`
 * terminava, o `router.push` para o roteiro disparava de onde a pessoa
 * estivesse (achado do Fable). A correção usa uma `saiuRef`, mesmo padrão de
 * `FolhaGravarAgora`. Atrasa a Server Action de propósito (mesma técnica de
 * `sem-rede.spec.ts` e `tests/e2e/momento.spec.ts`, "next-action" no
 * cabeçalho), porque com `AI_PROVIDER=mock` a geração é rápida demais para
 * pegar a corrida por sorte.
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
const EMAIL = "e2e-objetivo-voltar-depois@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("revisão do PR #62, item 2: Voltar depois no caminho do tema não navega depois", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-objetivo-voltar-depois"));
    if (jaExiste) return;

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-objetivo-voltar-depois", nome: "[teste] Objetivo voltar depois" })
      .returning();

    await db().insert(user).values({ id: "e2e-objetivo-voltar-depois", name: "[teste] Oficina", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-objetivo-voltar-depois-credential",
        issuer: "local:credential",
        accountId: "e2e-objetivo-voltar-depois",
        providerId: "credential",
        userId: "e2e-objetivo-voltar-depois",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-objetivo-voltar-depois", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-objetivo-voltar-depois", nome: "[teste] Oficina", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-objetivo-voltar-depois", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "conserto de eletrodomésticos",
          preco: "revisão simples por R$ 90",
          clienteIdeal: "mora perto da oficina",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "conserta eletrodomésticos na oficina própria",
        referencias: [],
      },
    });

    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("depois de 'Voltar depois', a geração terminar não navega para o roteiro", async ({ page }) => {
    // R1, item 0b: "Voltar depois" aparece desde o início (não espera mais o limiar de demora, hoje
    // em 3 min, `TelaEscrevendo.LIMIAR_DEMORANDO_MS`); o atraso artificial da Server Action só
    // precisa dar tempo de clicar nele antes de a geração terminar de verdade.
    test.setTimeout(60_000);
    let atrasou = false;
    await page.route("**/*", async (rota) => {
      const pedido = rota.request();
      if (!atrasou && pedido.method() === "POST" && pedido.headers()["next-action"]) {
        atrasou = true;
        await new Promise((resolve) => setTimeout(resolve, 13_000));
      }
      await rota.continue();
    });

    await entrar(page);
    await page.goto("/hoje/objetivo?tema=0");

    await page.getByRole("radio", { name: "Mais gente me conhecer" }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();

    await expect(page.getByText("Escrevendo o seu roteiro")).toBeVisible();
    const voltarDepois = page.getByRole("button", { name: "Voltar depois" });
    await expect(voltarDepois).toBeVisible({ timeout: 12_000 });
    await voltarDepois.click();

    await expect(page).toHaveURL(/\/hoje$/);

    // Espera passar do atraso artificial (13 s desde o clique em "escrever o roteiro", já se passaram uns
    // 10 s até aqui) mais folga: se a `saiuRef` nao pegasse, o `router.push` para o roteiro chegaria
    // agora e a URL mudaria sozinha.
    await page.waitForTimeout(8000);
    await expect(page).toHaveURL(/\/hoje$/);

    await page.unroute("**/*");
  });
});
