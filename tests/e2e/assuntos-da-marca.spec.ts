/**
 * E53, o motor: o admin põe, fixa e tira assuntos que a marca acompanha, na página da conta. Seguro para a repetição automática do Playwright:
 * o teste limpa os assuntos da marca antes de começar.
 */
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, assuntosDaMarca, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const USUARIO = "e2e-assuntos-marca";

async function marcaDoTeste(): Promise<number> {
  const [existente] = await db().select().from(clientes).where(eq(clientes.usuarioId, USUARIO));
  if (existente) return existente.id;
  const [nicho] = await db().insert(nichos).values({ slug: "e2e-assuntos-nicho", nome: "[teste] Assuntos", termos: [], pisoViews: 0 }).returning();
  await db().insert(user).values({ id: USUARIO, name: "Marca Assuntos", email: "assuntos@exemplo.teste" });
  await db()
    .insert(account)
    .values({ id: `${USUARIO}-credential`, issuer: "local:credential", accountId: USUARIO, providerId: "credential", userId: USUARIO, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: USUARIO, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: USUARIO, nome: "Marca Assuntos", nichoId: nicho.id, tipo: "negocio", persona: "negocio", alcance: "brasil" }).returning();
  await db().insert(membrosMarca).values({ usuarioId: USUARIO, clienteId: marca.id, papel: "dono" });
  return marca.id;
}

test("o admin põe um assunto na marca, fixa, recusa o repetido e tira", async ({ page }) => {
  const marcaId = await marcaDoTeste();
  await db().delete(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marcaId));

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);

  await page.goto(`/admin/clientes/${marcaId}`);
  const bloco = page.locator("[data-assuntos-da-marca]");
  await expect(bloco.getByText("Nenhum assunto acompanhado.")).toBeVisible();

  await bloco.getByLabel("Assunto", { exact: true }).fill("eleição");
  await bloco.getByLabel("Termos (separados por vírgula, opcional)").fill("Flávio, candidato");
  await bloco.getByRole("button", { name: "acompanhar este assunto" }).click();
  const item = bloco.locator("[data-assunto]").filter({ hasText: "eleição" });
  await expect(item).toBeVisible();
  await expect(item.getByText("termos: Flávio, candidato")).toBeVisible();
  await expect(item.getByText("0 notícias coletadas")).toBeVisible();

  await bloco.getByLabel("Assunto", { exact: true }).fill("ELEICAO");
  await bloco.getByRole("button", { name: "acompanhar este assunto" }).click();
  await expect(bloco.getByRole("alert")).toContainText("já está sendo acompanhado");

  await item.getByRole("button", { name: "fixar" }).click();
  await expect(item.getByText("(fixado)")).toBeVisible();

  await item.getByRole("button", { name: "tirar eleição" }).click();
  await expect(bloco.getByText("Nenhum assunto acompanhado.")).toBeVisible();
});
