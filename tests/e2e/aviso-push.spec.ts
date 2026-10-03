/**
 * E48, PR 2: o aviso de manhã por push, de ponta a ponta (a parte do aplicativo; o envio é o teste de integração do job).
 *
 * - O pedido de permissão (uma folha) aparece só no aplicativo instalado (emulado com `navigator.standalone`), só no celular e só uma vez: "Quero" registra
 *   a inscrição (o `pushManager` e a permissão são falsos, por `page.addInitScript`: o serviço de push de verdade não existe no teste), "Agora não" guarda
 *   a data no servidor, e nada disso volta na recarga.
 * - Fora do aplicativo instalado, nada é pedido.
 * - A Conta mostra o cartão "Aviso de manhã" nos estados: ligado, desligado (com o botão), sem permissão e "precisa instalar".
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, inscricoesPush, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const TITULO_PEDIDO = "Quer o aviso de manhã?";

function email(usuarioId: string): string {
  return `${usuarioId}@exemplo.teste`;
}

async function criarUsuario(usuarioId: string) {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (jaExiste) {
    // Repetição automática do Playwright: volta ao ponto de partida.
    await db().delete(inscricoesPush).where(eq(inscricoesPush.usuarioId, usuarioId));
    await db()
      .update(preferenciasUsuario)
      .set({ pushAdiadoAte: null, instaladoEm: null, instaladoEmSistema: null, conviteInstalarAdiadoAte: null })
      .where(eq(preferenciasUsuario.usuarioId, usuarioId));
    return;
  }
  const [nicho] = await db().insert(nichos).values({ slug: `${usuarioId}-nicho`, nome: "[teste] Oficina" }).returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Aviso", email: email(usuarioId) });
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
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date(), horaLembrete: "09:00" });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Aviso ${usuarioId}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
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
}

/**
 * O navegador do teste: o aplicativo instalado (ou não), a permissão do aviso e um `pushManager` falso que guarda a inscrição em `localStorage` (para
 * valer na recarga). A permissão pedida ao navegador vira `granted` ao pedir, a menos que o teste a negue.
 */
async function prepararAparelho(page: Page, opcoes: { instalado: boolean; permissao: "default" | "denied"; recusaAoPedir?: boolean }) {
  await page.addInitScript((o) => {
    if (o.instalado) Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    // A permissão do navegador vale entre recargas (a do teste também): fica em localStorage.
    let permissao = (localStorage.getItem("e2e-push-permissao") as NotificationPermission | null) ?? o.permissao;
    Object.defineProperty(Notification, "permission", { get: () => permissao, configurable: true });
    Notification.requestPermission = async () => {
      permissao = o.recusaAoPedir ? "denied" : "granted";
      localStorage.setItem("e2e-push-permissao", permissao);
      return permissao;
    };
    const chave = "e2e-push-inscricao";
    const montar = () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/e2e-" + window.location.hostname,
      toJSON() {
        return { endpoint: this.endpoint, keys: { p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" } };
      },
      unsubscribe: async () => {
        localStorage.removeItem(chave);
        return true;
      },
    });
    const falso = {
      getSubscription: async () => (localStorage.getItem(chave) ? montar() : null),
      subscribe: async () => {
        localStorage.setItem(chave, "1");
        return montar();
      },
    };
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { get: () => falso, configurable: true });
  }, opcoes);
}

async function entrar(page: Page, usuarioId: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(usuarioId));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

async function prefsDe(usuarioId: string) {
  const [prefs] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, usuarioId));
  return prefs;
}

test.describe("aviso de manhã: o pedido de permissão", () => {
  test.use({ userAgent: UA_ANDROID, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    for (const id of ["e2e-push-quero", "e2e-push-agoranao", "e2e-push-navegador", "e2e-push-negou"]) await criarUsuario(id);
  });

  test("no aplicativo instalado a folha aparece; 'Quero' registra a inscrição e a folha não volta na recarga", async ({ page }) => {
    await criarUsuario("e2e-push-quero");
    await prepararAparelho(page, { instalado: true, permissao: "default" });
    await entrar(page, "e2e-push-quero");

    const pedido = page.getByRole("dialog", { name: TITULO_PEDIDO });
    await expect(pedido).toBeVisible({ timeout: 8000 });
    await expect(pedido.getByText("Quer o aviso de manhã quando o roteiro do dia estiver pronto?")).toBeVisible();

    await pedido.getByRole("button", { name: "Quero" }).click();
    await expect(pedido).toHaveCount(0);

    await expect
      .poll(async () => (await db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, "e2e-push-quero"))).length)
      .toBe(1);
    const [feita] = await db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, "e2e-push-quero"));
    expect(feita.sistema).toBe("android");
    expect(feita.endpoint.startsWith("https://")).toBe(true);
    // O mesmo lugar também gravou que o aplicativo foi aberto instalado, e onde.
    await expect.poll(async () => (await prefsDe("e2e-push-quero")).instaladoEmSistema).toBe("android");

    await page.reload();
    await page.waitForTimeout(3000);
    await expect(page.getByRole("dialog", { name: TITULO_PEDIDO })).toHaveCount(0);
  });

  test("'Agora não' guarda a data no servidor (sete dias) e a folha não volta na recarga, nem em outro aparelho", async ({ page, browser, baseURL }) => {
    await criarUsuario("e2e-push-agoranao");
    await prepararAparelho(page, { instalado: true, permissao: "default" });
    await entrar(page, "e2e-push-agoranao");

    const pedido = page.getByRole("dialog", { name: TITULO_PEDIDO });
    await expect(pedido).toBeVisible({ timeout: 8000 });
    await pedido.getByRole("button", { name: "Agora não" }).click();
    await expect(pedido).toHaveCount(0);

    await expect
      .poll(async () => {
        const ate = (await prefsDe("e2e-push-agoranao")).pushAdiadoAte;
        if (!ate) return null;
        const dias = (ate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        return dias > 6.9 && dias < 7.1;
      })
      .toBe(true);
    expect(await db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, "e2e-push-agoranao"))).toEqual([]);

    await page.reload();
    await page.waitForTimeout(3000);
    await expect(page.getByRole("dialog", { name: TITULO_PEDIDO })).toHaveCount(0);

    // Outro aparelho da mesma pessoa: a data é dela, não do navegador.
    const outro = await browser.newContext({ baseURL, userAgent: UA_ANDROID, viewport: { width: 390, height: 844 }, isMobile: true });
    const paginaDois = await outro.newPage();
    await prepararAparelho(paginaDois, { instalado: true, permissao: "default" });
    await entrar(paginaDois, "e2e-push-agoranao");
    await paginaDois.waitForTimeout(3000);
    await expect(paginaDois.getByRole("dialog", { name: TITULO_PEDIDO })).toHaveCount(0);
    await outro.close();
  });

  test("fora do aplicativo instalado nada é pedido", async ({ page }) => {
    await criarUsuario("e2e-push-navegador");
    await prepararAparelho(page, { instalado: false, permissao: "default" });
    await entrar(page, "e2e-push-navegador");
    await page.waitForTimeout(3000);

    await expect(page.getByRole("dialog", { name: TITULO_PEDIDO })).toHaveCount(0);
  });

  test("a pessoa que diz não ao pedido do navegador conta como 'agora não' (sem inscrição, sem pedir de novo)", async ({ page }) => {
    await criarUsuario("e2e-push-negou");
    await prepararAparelho(page, { instalado: true, permissao: "default", recusaAoPedir: true });
    await entrar(page, "e2e-push-negou");

    const pedido = page.getByRole("dialog", { name: TITULO_PEDIDO });
    await expect(pedido).toBeVisible({ timeout: 8000 });
    await pedido.getByRole("button", { name: "Quero" }).click();
    await expect(pedido).toHaveCount(0);

    await expect.poll(async () => (await prefsDe("e2e-push-negou")).pushAdiadoAte !== null).toBe(true);
    expect(await db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, "e2e-push-negou"))).toEqual([]);
  });
});

test.describe("aviso de manhã: o cartão da Conta", () => {
  test.use({ userAgent: UA_ANDROID, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    for (const id of ["e2e-push-conta", "e2e-push-conta-negada", "e2e-push-conta-fora"]) await criarUsuario(id);
  });

  test("desligado: o botão liga, o cartão vira ligado (e a inscrição fica no servidor); desligar a apaga", async ({ page }) => {
    await criarUsuario("e2e-push-conta");
    // O pedido da folha já foi dito "agora não": o teste é do cartão.
    await db().update(preferenciasUsuario).set({ pushAdiadoAte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }).where(eq(preferenciasUsuario.usuarioId, "e2e-push-conta"));
    await prepararAparelho(page, { instalado: true, permissao: "default" });
    await entrar(page, "e2e-push-conta");
    await page.goto("/conta");

    const cartao = page.getByTestId("aviso-de-manha");
    await expect(cartao).toHaveAttribute("data-estado-do-aviso", "desligado");
    await expect(cartao.getByText("Desligado neste aparelho.")).toBeVisible();
    await expect(cartao.getByText("Horário do aviso: 09:00.")).toBeVisible();

    await cartao.getByRole("button", { name: "Ligar o aviso" }).click();
    await expect(cartao).toHaveAttribute("data-estado-do-aviso", "ligado", { timeout: 20_000 });
    await expect(cartao.getByText("Ligado neste aparelho.")).toBeVisible();
    await expect.poll(async () => (await db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, "e2e-push-conta"))).length).toBe(1);

    // Recarregar mantém: a inscrição é do aparelho (o falso a guarda em localStorage).
    await page.reload();
    await expect(page.getByTestId("aviso-de-manha")).toHaveAttribute("data-estado-do-aviso", "ligado");

    await page.getByTestId("aviso-de-manha").getByRole("button", { name: "Desligar neste aparelho" }).click();
    await expect(page.getByTestId("aviso-de-manha")).toHaveAttribute("data-estado-do-aviso", "desligado");
    await expect.poll(async () => (await db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, "e2e-push-conta"))).length).toBe(0);
  });

  test("sem permissão: o cartão diz o caminho para os ajustes do aparelho, sem botão", async ({ page }) => {
    await criarUsuario("e2e-push-conta-negada");
    await prepararAparelho(page, { instalado: true, permissao: "denied" });
    await entrar(page, "e2e-push-conta-negada");
    await page.goto("/conta");

    const cartao = page.getByTestId("aviso-de-manha");
    await expect(cartao).toHaveAttribute("data-estado-do-aviso", "sem_permissao");
    await expect(cartao.getByText("Nos ajustes do celular, procure o aplicativo e ligue as notificações.", { exact: false })).toBeVisible();
    await expect(cartao.getByRole("button")).toHaveCount(0);
  });

  test("fora do aplicativo instalado: o cartão manda instalar primeiro, sem botão", async ({ page }) => {
    await criarUsuario("e2e-push-conta-fora");
    await prepararAparelho(page, { instalado: false, permissao: "default" });
    await entrar(page, "e2e-push-conta-fora");
    await page.goto("/conta");

    const cartao = page.getByTestId("aviso-de-manha");
    await expect(cartao).toHaveAttribute("data-estado-do-aviso", "precisa_instalar");
    await expect(cartao.getByText("instale o aplicativo na tela de início do celular", { exact: false })).toBeVisible();
    await expect(cartao.getByRole("button")).toHaveCount(0);
  });
});
