/**
 * M4, item 6: gerar um roteiro sem fala pelo Hoje (folha "Gravar agora", controle segmentado
 * "Como você aparece") e ver os cartões sem o campo de fala, com a legenda do post como último
 * cartão. Mesma lição de `story.spec.ts` e `momento.spec.ts`: nicho próprio ("e2e-sem-fala"), sem
 * linha em `temas_dia` (a folha não depende de tema do dia), geração contra o `AI_PROVIDER=mock`.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-sem-fala@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("M4, o roteiro sem fala", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-sem-fala"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-sem-fala", nome: "[teste] Sem fala" }).returning();

    await db().insert(user).values({ id: "e2e-sem-fala", name: "[teste] Sem fala", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-sem-fala-credential",
        issuer: "local:credential",
        accountId: "e2e-sem-fala",
        providerId: "credential",
        userId: "e2e-sem-fala",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-sem-fala", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-sem-fala", nome: "[teste] Sem fala", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-sem-fala", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "envelopamento automotivo",
          preco: "envelopamento completo por R$ 2.500",
          clienteIdeal: "dono de carro que gosta de deixar o carro diferente",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "envelopamento e pelicula automotiva",
        referencias: [],
      },
    });
  });

  test("escolhe sem fala na folha, gera o roteiro, e os cartões não têm 'o que falar', só 'o que mostrar' e a legenda", async ({
    page,
  }) => {
    await entrar(page);
    await page.goto("/criar/tema-livre");

    await page.getByRole("button", { name: "Estou num momento" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("na oficina");
    await folha.getByLabel("O que está acontecendo").fill("envelopando o capo de um carro");
    await folha.getByLabel("O que dá para mostrar").fill("o antes fosco e o depois brilhando");
    await folha.getByRole("button", { name: "Que muita gente veja" }).click();

    const controleEstilo = folha.getByRole("tablist", { name: "Como você aparece" });
    await expect(controleEstilo.getByRole("tab", { name: "Falando" })).toHaveAttribute("aria-selected", "true");
    await controleEstilo.getByRole("tab", { name: /Sem fala/ }).click();
    await expect(controleEstilo.getByRole("tab", { name: /Sem fala/ })).toHaveAttribute("aria-selected", "true");

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    await expect(page.getByText(/^Cena 1 de \d+$/).first()).toBeVisible();
    await expect(page.getByText("O que mostrar").first()).toBeVisible();
    await expect(page.getByText("Texto na tela").first()).toBeVisible();
    // Nunca "o que falar": o estilo sem fala não tem bloco de fala nenhum.
    await expect(page.getByText("O que falar")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Como editar" })).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Legenda do post" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copiar" })).toBeVisible();
  });

  test("falando (padrão) continua gerando um roteiro normal, sem legenda nenhuma", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/tema-livre");

    await page.getByRole("button", { name: "Estou num momento" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("na oficina");
    await folha.getByLabel("O que está acontecendo").fill("mostrando o resultado para o cliente");
    await folha.getByLabel("O que dá para mostrar").fill("o cliente vendo o carro pronto");
    await folha.getByRole("button", { name: "Que muita gente veja" }).click();

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Como editar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Legenda do post" })).toHaveCount(0);
  });
});
