/**
 * E42a, item 1 (achado do Gustavo em 02/10, no Começar pelo celular: "tá muito limitado ao
 * Brasil e se for outro país não tá falando nada"): as duas opções novas de "onde está o seu
 * público" ("Em outro país" e "Em mais de um país"), no Começar e editáveis pela Conta.
 *
 * Mesmo cuidado de `briefing-pessoa.spec.ts`: nunca chama `avaliarResposta` (ou qualquer coisa de
 * `src/ia`) direto no corpo do teste, só pela tela, contra o `AI_PROVIDER=mock` do servidor.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("E42a: onde está o seu público, fora do Brasil", () => {
  const EMAIL_COMECAR = "e2e-publico-fora-brasil-comecar@exemplo.teste";
  const EMAIL_COMECAR_2 = "e2e-publico-fora-brasil-comecar-2@exemplo.teste";
  const EMAIL_CONTA = "e2e-publico-fora-brasil-conta@exemplo.teste";

  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-publico-fora-brasil-comecar"));
    if (jaExiste) return;

    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    /**
     * Um cliente por teste do Começar (nunca o mesmo para "outro_pais" e "mais_de_um_pais"): a
     * escolha ali grava de verdade no servidor, então reusar o mesmo cliente faria o segundo
     * teste encontrar o passo de dados fixos já completo (achado escrevendo este teste).
     */
    async function criarClienteComecar(usuarioId: string, email: string, nome: string) {
      await db().insert(user).values({ id: usuarioId, name: nome, email });
      await db()
        .insert(account)
        .values({
          id: `${usuarioId}-credential`,
          issuer: "local:credential",
          accountId: usuarioId,
          providerId: "credential",
          userId: usuarioId,
          password: await hashPassword(SENHA),
        });
      const [cliente] = await db()
        .insert(clientes)
        .values({ usuarioId, nome, nichoId: nicho.id, tipo: "pessoa", persona: "conhecido" })
        .returning();
      await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
    }

    await criarClienteComecar("e2e-publico-fora-brasil-comecar", EMAIL_COMECAR, "[teste] Começar público fora");
    await criarClienteComecar("e2e-publico-fora-brasil-comecar-2", EMAIL_COMECAR_2, "[teste] Começar público fora 2");

    // Cliente 3: briefing completo, direto em /hoje, para o fluxo de editar pela Conta.
    await db().insert(user).values({ id: "e2e-publico-fora-brasil-conta", name: "[teste] Conta", email: EMAIL_CONTA });
    await db()
      .insert(account)
      .values({
        id: "e2e-publico-fora-brasil-conta-credential",
        issuer: "local:credential",
        accountId: "e2e-publico-fora-brasil-conta",
        providerId: "credential",
        userId: "e2e-publico-fora-brasil-conta",
        password: await hashPassword(SENHA),
      });
    const [clienteConta] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-publico-fora-brasil-conta",
        nome: "[teste] Conta público fora",
        nichoId: nicho.id,
        tipo: "negocio",
        persona: "negocio",
        alcance: "brasil",
      })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-publico-fora-brasil-conta", clienteId: clienteConta.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-publico-fora-brasil-conta", aceitouTermosEm: new Date() });
    await db()
      .insert(briefings)
      .values({
        clienteId: clienteConta.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "consultoria de carreira",
            preco: "sessão a partir de 200 reais",
            clienteIdeal: "profissional em transição de carreira",
            medos: [],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: [],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "consultoria de carreira para profissionais em transição",
          referencias: [],
        },
      });
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("Começar: 'Em outro país' pede o país e avisa que a pesquisa continua só no Brasil", async ({ page }) => {
    await entrar(page, EMAIL_COMECAR);
    await expect(page).toHaveURL(/\/comecar/);
    await page.getByRole("button", { name: "Começar", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sobre você" })).toBeVisible();
    await page.getByRole("radio", { name: "Em outro país" }).click();

    await expect(page.getByLabel("Qual país?")).toBeVisible();
    await expect(page.getByText("a pesquisa de vídeos que vira roteiro olha só o Brasil")).toBeVisible();

    // Sem o país escrito, "Continuar" não passa (mesma validação de "local" sem região).
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sobre você" })).toBeVisible();

    await page.getByLabel("Qual país?").fill("Portugal");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    // Passou para o bloco 1: a opção foi aceita e gravada.
    await expect(page.getByLabel("Quem é você e o que você faz hoje")).toBeVisible();
  });

  test("Começar: 'Em mais de um país' pede quais países", async ({ page }) => {
    await entrar(page, EMAIL_COMECAR_2);
    await expect(page).toHaveURL(/\/comecar/);
    await page.getByRole("button", { name: "Começar", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sobre você" })).toBeVisible();
    await page.getByRole("radio", { name: "Em mais de um país" }).click();

    await expect(page.getByLabel("Quais países?")).toBeVisible();
    await page.getByLabel("Quais países?").fill("Estados Unidos e México");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    await expect(page.getByLabel("Quem é você e o que você faz hoje")).toBeVisible();
  });

  test("Conta: troca de 'No Brasil inteiro' para 'Em outro país', salva, e continua depois de recarregar", async ({ page }) => {
    await entrar(page, EMAIL_CONTA);
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/conta");

    await expect(page.getByRole("button", { name: "No Brasil inteiro", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Em outro país", exact: true }).click();
    await page.getByLabel("Qual país?").fill("Canadá");
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Em outro país", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Qual país?")).toHaveValue("Canadá");
  });
});
