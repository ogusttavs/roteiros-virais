/**
 * O "ver como" (E46 PR 2), pela tela: o admin liga o modo numa pessoa da conta, vê o Hoje dela com a faixa, tenta gerar roteiro e recebe a recusa, o Conta desliga o salvar, e sai
 * do modo de volta ao admin; a entrada e a saída ficam registradas; nada vira sessão da pessoa e a visita não conta como acesso dela; cookie forjado sem sessão de admin cai em
 * `/entrar`, cookie sobrando numa sessão de cliente é ignorado e apagado, e o modo expira.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { count, desc, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, session, temasDia, user, verComoEntradas, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA = "ExemploSenha123";
const PESSOA = "e2e-vercomo-pessoa";
const PESSOA_EMAIL = "pessoa-vercomo@exemplo.teste";
const OUTRA = "e2e-vercomo-outra";
const OUTRA_EMAIL = "outra-vercomo@exemplo.teste";

let clienteId: number;

async function entrar(page: Page, email: string, aguardar: RegExp) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(aguardar);
}

async function ultimaEntrada() {
  const [e] = await db().select().from(verComoEntradas).where(eq(verComoEntradas.clienteId, clienteId)).orderBy(desc(verComoEntradas.id)).limit(1);
  return e;
}

test.describe("ver como", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, PESSOA));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, PESSOA));
      clienteId = marca.id;
      return;
    }
    const [nicho] = await db().insert(nichos).values({ slug: PESSOA, nome: "[teste] Ver como" }).returning();
    for (const [id, email, nome] of [
      [PESSOA, PESSOA_EMAIL, "Paula Vista E2E"],
      [OUTRA, OUTRA_EMAIL, "Outra Pessoa E2E"],
    ]) {
      await db().insert(user).values({ id, name: nome, email });
      await db().insert(account).values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
    }
    // A pessoa vista ainda NÃO aceitou os termos: o admin não pode aceitar por ela (nem ver a folha de aceite no lugar do painel).
    await db().insert(preferenciasUsuario).values({ usuarioId: PESSOA });
    await db().insert(preferenciasUsuario).values({ usuarioId: OUTRA, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: PESSOA, nome: "[teste e2e] Marca Vista", nichoId: nicho.id }).returning();
    clienteId = marca.id;
    await db().insert(membrosMarca).values({ usuarioId: PESSOA, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "lavagem de estofados", preco: "sofá por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
    const temas: TemaDoDia[] = [{ titulo: "tema da marca vista", descricao: "d1", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" }];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("o admin liga o modo, vê o painel da pessoa com a faixa, a recusa vale no servidor, e sai", async ({ page }) => {
    await entrar(page, EMAIL_ADMIN, /\/admin\/?$/);
    const sessoesDaPessoaAntes = (await db().select({ total: count() }).from(session).where(eq(session.userId, PESSOA)))[0].total;

    await page.goto(`/admin/clientes/${clienteId}`);
    const acesso = page.locator('[data-bloco="acesso"]');
    await acesso.getByRole("button", { name: "Ver o painel como Paula Vista E2E" }).click();
    const folha = page.getByRole("dialog", { name: "Ver o painel como" });
    await expect(folha).toContainText("Fica registrado");
    await expect(folha).toContainText("30 minutos");
    await folha.getByRole("button", { name: "Ver como Paula Vista E2E" }).click();

    // O Hoje dela, com a faixa fixa no alto.
    await expect(page).toHaveURL(/\/hoje/);
    const faixa = page.locator("[data-faixa-ver-como]");
    await expect(faixa).toContainText("Você está vendo como Paula Vista E2E, conta [teste e2e] Marca Vista");
    await expect(faixa).toContainText("termina em");
    await expect(faixa.getByRole("button", { name: "Sair do modo" })).toBeVisible();
    // A pessoa ainda não aceitou os termos: o admin vê o painel, não a folha de aceite.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Regra 4, 2 e 6: a entrada está no banco; a pessoa não ganhou sessão; a visita não virou acesso dela.
    const entrada = await ultimaEntrada();
    expect(entrada.saiuEm).toBeNull();
    expect(entrada.pessoaId).toBe(PESSOA);
    expect(entrada.expiraEm.getTime() - entrada.entrouEm.getTime()).toBe(30 * 60 * 1000);
    expect((await db().select({ total: count() }).from(session).where(eq(session.userId, PESSOA)))[0].total).toBe(sessoesDaPessoaAntes);
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(marca.ultimoAcessoEm).toBeNull();
    const [prefs] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, PESSOA));
    expect(prefs.aceitouTermosEm).toBeNull();

    // Regra 5: gerar roteiro é recusado pelo servidor, com o motivo na tela.
    await page.goto(`/criar/objetivo?livre=${encodeURIComponent("um assunto qualquer")}`);
    await expect(faixa).toBeVisible();
    await page.locator("[data-fichas]").getByRole("radio", { name: /Que mandem para alguém/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page.getByText(/Desligado no modo ver como/)).toBeVisible();
    await expect(page).toHaveURL(/\/criar\/objetivo/);
    expect((await db().select({ total: count() }).from(roteiros).where(eq(roteiros.clienteId, clienteId)))[0].total).toBe(0);

    // Conta: o salvar desligado, com o motivo; Sair e o aviso de manhã não aparecem.
    await page.goto("/conta");
    await expect(page.getByRole("button", { name: "salvar", exact: true })).toBeDisabled();
    await expect(page.locator("#motivo-salvar")).toContainText("Desligado no modo ver como");
    await expect(page.getByRole("button", { name: "Sair", exact: true })).toHaveCount(0);

    // Sair do modo: volta à página da conta no admin, a entrada fecha como "saiu", o cookie some.
    await faixa.getByRole("button", { name: "Sair do modo" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/clientes/${clienteId}$`));
    const fechada = await ultimaEntrada();
    expect(fechada.motivoSaida).toBe("saiu");
    expect((await page.context().cookies()).some((c) => c.name === "ver_como")).toBe(false);
    await expect(page.locator('[data-bloco="ver-como"]')).toContainText("viu como Paula Vista E2E");

    // Fora do modo, o painel não mostra mais a faixa.
    await page.goto("/hoje");
    await expect(page.locator("[data-faixa-ver-como]")).toHaveCount(0);
  });

  test("o modo expira: passada a hora do banco, a faixa some e a entrada fecha como 'expirou'", async ({ page }) => {
    await entrar(page, EMAIL_ADMIN, /\/admin\/?$/);
    await page.goto(`/admin/clientes/${clienteId}`);
    await page.locator('[data-bloco="acesso"]').getByRole("button", { name: "Ver o painel como Paula Vista E2E" }).click();
    await page.getByRole("dialog", { name: "Ver o painel como" }).getByRole("button", { name: "Ver como Paula Vista E2E" }).click();
    await expect(page.locator("[data-faixa-ver-como]")).toBeVisible();

    const entrada = await ultimaEntrada();
    await db().update(verComoEntradas).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(verComoEntradas.id, entrada.id));
    await page.goto("/hoje");
    await expect(page.locator("[data-faixa-ver-como]")).toHaveCount(0);
    expect((await ultimaEntrada()).motivoSaida).toBe("expirou");
    expect((await page.context().cookies()).some((c) => c.name === "ver_como")).toBe(false);
  });

  test("um cliente comum não entra no modo: cookie forjado sem sessão cai em /entrar; com sessão de cliente, é ignorado e apagado", async ({ browser }) => {
    // Sem sessão nenhuma, com o cookie forjado.
    const semSessao = await browser.newContext();
    await semSessao.addCookies([{ name: "ver_como", value: "forjado.0000", url: "http://localhost:3000" }]);
    const pagina = await semSessao.newPage();
    await pagina.goto("/hoje");
    await expect(pagina).toHaveURL(/\/entrar/);
    await semSessao.close();

    // Com sessão de CLIENTE: o cookie (mesmo que viesse certo) nunca vira modo; sobrando, é apagado, e o painel é o da própria pessoa, sem faixa.
    const comoCliente = await browser.newContext();
    const p = await comoCliente.newPage();
    await entrar(p, OUTRA_EMAIL, /\/(hoje|comecar)/);
    await comoCliente.addCookies([{ name: "ver_como", value: "forjado.0000", url: "http://localhost:3000" }]);
    await p.goto("/conta");
    await expect(p.locator("[data-faixa-ver-como]")).toHaveCount(0);
    expect((await comoCliente.cookies()).some((c) => c.name === "ver_como")).toBe(false);
    await comoCliente.close();
  });
});
