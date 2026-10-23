/**
 * Conta com sessao e sem marca ativa (22/10/2026): marca apagada, ou convite que nao ligou nenhuma. Antes `/hoje` mandava para `/comecar`, `/comecar` para `/entrar` e
 * `/entrar`, com sessao, de volta para `/hoje`: o navegador parava com "muitos redirecionamentos" (o `goto` do Playwright falha com ERR_TOO_MANY_REDIRECTS se o laco voltar).
 * Agora todas as portas levam a `/sem-marca`; o admin nunca cai ali; quem tem marca nao nota nada.
 *
 * Mesmo padrao de `aceite-termos.spec.ts`: dados proprios gravados direto no banco, sem `resetarSchema`.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL_SEM_MARCA = "e2e-sem-marca@exemplo.teste";
const EMAIL_MARCA_APAGADA = "e2e-marca-apagada@exemplo.teste";
const EMAIL_COM_MARCA = "e2e-com-marca@exemplo.teste";
const EMAIL_ADMIN_SEM_MARCA = "e2e-admin-sem-marca@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

async function criarPessoa(id: string, email: string, papel: "cliente" | "admin") {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, id));
  if (jaExiste) return false;
  await db().insert(user).values({ id, name: `[teste] ${id}`, email, role: papel });
  await db()
    .insert(account)
    .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
  return true;
}

async function criarMarcaCompleta(usuarioId: string) {
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] marca de ${usuarioId}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true });
  return cliente.id;
}

test.describe("conta com sessao e sem marca", () => {
  test.beforeAll(async () => {
    await criarPessoa("e2e-sem-marca", EMAIL_SEM_MARCA, "cliente");
    if (await criarPessoa("e2e-marca-apagada", EMAIL_MARCA_APAGADA, "cliente")) await criarMarcaCompleta("e2e-marca-apagada");
    if (await criarPessoa("e2e-com-marca", EMAIL_COM_MARCA, "cliente")) await criarMarcaCompleta("e2e-com-marca");
    await criarPessoa("e2e-admin-sem-marca", EMAIL_ADMIN_SEM_MARCA, "admin");
  });

  test("entra e cai na tela propria; nenhuma porta do painel faz laco; sair funciona", async ({ page }) => {
    await entrar(page, EMAIL_SEM_MARCA);
    await expect(page).toHaveURL(/\/sem-marca$/);
    await expect(page.getByRole("heading", { name: "Sua conta ainda não tem uma marca" })).toBeVisible();
    await expect(page.getByText(EMAIL_SEM_MARCA)).toBeVisible();

    // Cada porta que antes entrava no laco (`goto` falharia com ERR_TOO_MANY_REDIRECTS): todas terminam na tela propria.
    for (const rota of ["/hoje", "/comecar", "/entrar", "/criar", "/criar/tema-livre", "/briefing", "/historico", "/noticias", "/referencias", "/conta", "/assinar", "/roteiros/1"]) {
      await page.goto(rota);
      await expect(page, rota).toHaveURL(/\/sem-marca$/);
    }

    await page.getByRole("button", { name: "sair", exact: true }).click();
    await expect(page).toHaveURL(/\/entrar/);

    // Sem sessao, a tela propria nao fica aberta: volta a entrar.
    await page.goto("/sem-marca");
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("a marca apagada com a sessao aberta (o caso de producao) vai para a tela propria, sem laco", async ({ page }) => {
    await entrar(page, EMAIL_MARCA_APAGADA);
    await expect(page).toHaveURL(/\/hoje/);

    const membros = await db().select({ clienteId: membrosMarca.clienteId }).from(membrosMarca).where(eq(membrosMarca.usuarioId, "e2e-marca-apagada"));
    for (const { clienteId } of membros) {
      await db().delete(membrosMarca).where(eq(membrosMarca.clienteId, clienteId));
      await db().delete(briefings).where(eq(briefings.clienteId, clienteId));
      await db().delete(clientes).where(eq(clientes.id, clienteId));
    }

    await page.goto("/hoje");
    await expect(page).toHaveURL(/\/sem-marca$/);
    await page.goto("/entrar");
    await expect(page).toHaveURL(/\/sem-marca$/);
  });

  test("com marca nada muda: /entrar e /hoje abrem o Hoje, e a tela propria devolve ao Hoje", async ({ page }) => {
    await entrar(page, EMAIL_COM_MARCA);
    await expect(page).toHaveURL(/\/hoje/);
    await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();

    await page.goto("/entrar");
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/sem-marca");
    await expect(page).toHaveURL(/\/hoje/);
  });

  test("o admin nunca cai na tela de conta sem marca: vai para /admin, com ou sem marca", async ({ page }) => {
    await entrar(page, EMAIL_ADMIN_SEM_MARCA);
    await expect(page).toHaveURL(/\/admin\/?$/);

    await page.goto("/sem-marca");
    await expect(page).toHaveURL(/\/admin\/?$/);
    await page.goto("/hoje");
    await expect(page).toHaveURL(/\/admin\/?$/);
    await page.goto("/entrar");
    await expect(page).toHaveURL(/\/admin\/?$/);
  });
});
