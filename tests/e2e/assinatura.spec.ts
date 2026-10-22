/**
 * A assinatura pelo Stripe (E22 PR 1), pelo servidor de verdade (`next start` com o Stripe simulado, nunca a rede): o aviso do Stripe passa pelo middleware e é conferido pela
 * assinatura do corpo, o estado da assinatura aparece na lista de Contas do admin, o admin liga a cortesia, e o dono da marca chega ao pagamento simulado pelo botão de `/assinar`.
 * O portão em si (a marca sem assinatura cai em `/assinar`) está provado no teste do layout; aqui ele fica desligado, como em produção.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "../../src/db";
import { account, assinaturas, clientes, eventosStripe, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA = "ExemploSenha123";
const DONO_ID = "e2e-assinatura-dono";
const DONO_EMAIL = "dono-e2e-assinatura@exemplo.teste";
/** O mesmo segredo do `webServer.env` do `playwright.config.ts`: só de teste. */
const SEGREDO_DO_AVISO = "whsec_e2e_nao_e_um_segredo_de_verdade";
const stripeSoParaAssinar = new Stripe("sk_test_nunca_usada_nos_testes");

let marca: number;

async function entrar(page: Page, email: string, destino: RegExp): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(destino);
}

function avisoDeAssinatura(): string {
  const agora = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id: `evt_e2e_${agora}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type: "customer.subscription.created",
    created: agora,
    data: {
      object: {
        id: "sub_e2e_assinatura",
        object: "subscription",
        customer: "cus_e2e_assinatura",
        status: "active",
        metadata: { produto: "roteiros", cliente_id: String(marca) },
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_e2e" }, current_period_start: agora, current_period_end: agora + 90 * 86400 }] },
      },
    },
  });
}

test.describe("assinatura pelo Stripe", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).limit(1);
    await db().delete(user).where(eq(user.id, DONO_ID));
    await db().insert(user).values({ id: DONO_ID, name: "Dono Assinatura E2E", email: DONO_EMAIL });
    await db().insert(account).values({ id: `${DONO_ID}-c`, issuer: "local:credential", accountId: DONO_ID, providerId: "credential", userId: DONO_ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: DONO_ID, aceitouTermosEm: new Date() });
    const [c] = await db().insert(clientes).values({ nome: "[teste e2e] Marca da Assinatura", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" }).returning();
    marca = c.id;
    await db().insert(membrosMarca).values({ usuarioId: DONO_ID, clienteId: marca, papel: "dono" });
    await db().delete(assinaturas).where(eq(assinaturas.stripeAssinaturaId, "sub_e2e_assinatura"));
  });

  test("o aviso do Stripe passa pelo middleware: sem assinatura 400, com a assinatura certa 200, e a lista de Contas mostra a assinatura", async ({ page, request }) => {
    // Sem cookie de sessão, e sem ser redirecionado para /entrar: a rota tem autenticação própria.
    const semAssinatura = await request.post("/api/webhooks/stripe", { data: avisoDeAssinatura(), headers: { "content-type": "application/json" }, maxRedirects: 0 });
    expect(semAssinatura.status()).toBe(400);

    const errada = avisoDeAssinatura();
    const cabecalhoErrado = stripeSoParaAssinar.webhooks.generateTestHeaderString({ payload: errada, secret: "whsec_de_outra_conta" });
    const recusada = await request.post("/api/webhooks/stripe", { data: errada, headers: { "content-type": "application/json", "stripe-signature": cabecalhoErrado }, maxRedirects: 0 });
    expect(recusada.status()).toBe(400);
    expect(await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca))).toHaveLength(0);

    const corpo = avisoDeAssinatura();
    const cabecalho = stripeSoParaAssinar.webhooks.generateTestHeaderString({ payload: corpo, secret: SEGREDO_DO_AVISO });
    const aceita = await request.post("/api/webhooks/stripe", { data: corpo, headers: { "content-type": "application/json", "stripe-signature": cabecalho }, maxRedirects: 0 });
    expect(aceita.status()).toBe(200);
    // O mesmo aviso de novo: 200 e nada duplicado.
    const repetida = await request.post("/api/webhooks/stripe", { data: corpo, headers: { "content-type": "application/json", "stripe-signature": cabecalho }, maxRedirects: 0 });
    expect(repetida.status()).toBe(200);
    expect(await db().select().from(assinaturas).where(eq(assinaturas.clienteId, marca))).toHaveLength(1);
    expect((await db().select().from(eventosStripe)).filter((e) => e.eventoId === JSON.parse(corpo).id)).toHaveLength(1);

    await entrar(page, EMAIL_ADMIN, /\/admin\/?$/);
    await page.goto("/admin/clientes");
    await expect(page.getByRole("columnheader", { name: "Assinatura" })).toBeVisible();
    await expect(page.locator(`tr[data-conta="${marca}"] td[data-assinatura="active"]`)).toContainText(/^Ativa até \d\d\/\d\d\/\d\d$/);
  });

  test("o admin liga a cortesia da conta e a lista passa a dizer Cortesia", async ({ page }) => {
    await entrar(page, EMAIL_ADMIN, /\/admin\/?$/);
    await page.goto(`/admin/clientes/${marca}`);
    const bloco = page.locator('[data-ajuste="assinatura"]');
    await expect(bloco).toContainText("Assinatura");
    const caixa = bloco.getByRole("checkbox", { name: "Cortesia" });
    await expect(caixa).not.toBeChecked();
    await caixa.check();
    await expect(bloco.getByText("Salvo")).toBeVisible();
    expect((await db().select().from(clientes).where(eq(clientes.id, marca)))[0].cortesia).toBe(true);
    await page.goto("/admin/clientes");
    await expect(page.locator(`tr[data-conta="${marca}"] td[data-assinatura="cortesia"]`)).toHaveText("Cortesia");
    await page.goto(`/admin/clientes/${marca}`);
    const caixaDeNovo = page.locator('[data-ajuste="assinatura"]').getByRole("checkbox", { name: "Cortesia" });
    await expect(caixaDeNovo).toBeChecked();
    await caixaDeNovo.uncheck();
    await expect(page.locator('[data-ajuste="assinatura"]').getByText("Salvo")).toBeVisible();
    expect((await db().select().from(clientes).where(eq(clientes.id, marca)))[0].cortesia).toBe(false);
  });

  test("o dono da marca em /assinar: o plano em uma linha, e o botão leva ao pagamento (simulado)", async ({ page }) => {
    await db().delete(assinaturas).where(eq(assinaturas.clienteId, marca));
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/assinar");
    await expect(page.getByRole("heading", { name: "Assine para continuar" })).toBeVisible();
    await expect(page.getByText("Plano trimestral: R$ 397 por mês, cobrados R$ 1.191 a cada 3 meses, no cartão.")).toBeVisible();
    await page.getByRole("button", { name: "Assinar", exact: true }).click();
    await expect(page).toHaveURL(/\/assinar\?simulado=checkout/);
  });

  test("voltando do pagamento sem o aviso ainda: 'estamos confirmando', sem o botao de assinar; com o aviso, segue para o Hoje", async ({ page }) => {
    await db().delete(assinaturas).where(eq(assinaturas.clienteId, marca));
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/assinar?assinou=1");
    await expect(page.getByText("Estamos confirmando o seu pagamento.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assinar", exact: true })).toHaveCount(0);

    const agora = new Date();
    await db().insert(assinaturas).values({
      clienteId: marca,
      status: "active",
      stripeClienteId: "cus_e2e_confirmando",
      stripeAssinaturaId: "sub_e2e_confirmando",
      periodoFim: new Date(agora.getTime() + 90 * 86400 * 1000),
      ultimoEventoEm: agora,
    });
    await page.goto("/assinar?assinou=1");
    await expect(page).toHaveURL(/\/(hoje|comecar)/);
    await db().delete(assinaturas).where(eq(assinaturas.clienteId, marca));
  });
});
