/**
 * Prova do achado de seguranca em producao (20/09/2026, `PROXIMO.md`, item 5):
 * sem `exigirAdmin()` nas paginas, um pedido sem sessao valida para
 * `/admin/...` voltava com status 307 (redirecionado), mas o CORPO da
 * resposta trazia o dado renderizado (o App Router roda o layout e a pagina
 * em paralelo). Conferir so o status nao provava nada, porque o status ja
 * era 307 com o defeito; estes testes leem o corpo, sem seguir o redirect
 * (`maxRedirects: 0`), nos quatro casos do item 5: sem cookie, cookie falso,
 * sessao de cliente comum e sessao de admin. O mesmo teste vale para
 * `clientes/[id]`, `geracoes/[id]` e `nichos/[slug]`.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { clientes, contas, geracoesIA, nichos, user } from "../../src/db/schema";

const EMAIL_ADMIN = "admin@exemplo.teste";
const EMAIL_CLIENTE_COMUM = "seed-cliente-dentistas@exemplo.teste";
const SENHA_SEED = "ExemploSenha123";

/** O mesmo formato de cookie falso que o achado do Fable usou em producao. */
const COOKIE_FALSO = "better-auth.session_token=falso.token";

const MARCA_UNICA_GERACAO = "[exemplo-e2e-admin-protegido] entrada que nao pode vazar sem sessao de admin";

let clienteId: number;
let clienteNome: string;
let clienteEmail: string;
let geracaoId: number;
let nichoSlug: string;
let contaVigiadaHandle: string;

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function cookieDeSessao(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessao = cookies.find((c) => c.name === "better-auth.session_token");
  if (!sessao) throw new Error("sessao nao encontrada nos cookies depois do login");
  return `${sessao.name}=${sessao.value}`;
}

async function corpoSemRedirecionar(
  request: APIRequestContext,
  caminho: string,
  cookie?: string,
): Promise<{ status: number; corpo: string }> {
  const resposta = await request.get(caminho, {
    maxRedirects: 0,
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: resposta.status(), corpo: await resposta.text() };
}

/**
 * Prova os quatro casos do item 5 para um recurso do admin: sem cookie,
 * cookie falso e sessao de cliente comum devolvem 307 e o corpo nunca traz
 * nenhum dos `marcadores`; sessao de admin devolve 200 e o corpo traz todos.
 * `caminhosSemDado` inclui a variante ".0" (achado do middleware) quando o
 * recurso usa id numerico; `caminhoCanonico` e o que a sessao de admin le.
 */
async function provarQueSoAdminVe(
  page: Page,
  request: APIRequestContext,
  caminhoCanonico: string,
  caminhosSemDado: string[],
  marcadores: string[],
): Promise<void> {
  for (const cookie of [undefined, COOKIE_FALSO]) {
    for (const caminho of caminhosSemDado) {
      const { status, corpo } = await corpoSemRedirecionar(request, caminho, cookie);
      expect(status).toBe(307);
      for (const marcador of marcadores) expect(corpo).not.toContain(marcador);
    }
  }

  await entrar(page, EMAIL_CLIENTE_COMUM);
  const cookieCliente = await cookieDeSessao(page);
  for (const caminho of caminhosSemDado) {
    const { status, corpo } = await corpoSemRedirecionar(request, caminho, cookieCliente);
    expect(status).toBe(307);
    for (const marcador of marcadores) expect(corpo).not.toContain(marcador);
  }

  await page.context().clearCookies();
  await entrar(page, EMAIL_ADMIN);
  const cookieAdmin = await cookieDeSessao(page);
  const { status, corpo } = await corpoSemRedirecionar(request, caminhoCanonico, cookieAdmin);
  expect(status).toBe(200);
  for (const marcador of marcadores) expect(corpo).toContain(marcador);
}

test.describe("admin: as paginas conferem o papel antes de consultar", () => {
  test.beforeAll(async () => {
    const [cliente] = await db()
      .select({ id: clientes.id, nome: clientes.nome, usuarioId: clientes.usuarioId })
      .from(clientes)
      .where(eq(clientes.usuarioId, "seed-cliente-dentistas"));
    clienteId = cliente.id;
    clienteNome = cliente.nome;

    const [usuarioCliente] = await db().select({ email: user.email }).from(user).where(eq(user.id, cliente.usuarioId));
    clienteEmail = usuarioCliente.email;

    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
    nichoSlug = nicho.slug;

    const [contaVigiada] = await db()
      .select({ handle: contas.handle })
      .from(contas)
      .where(and(eq(contas.nichoId, nicho.id), eq(contas.vigiada, true)));
    contaVigiadaHandle = contaVigiada.handle;

    const [geracao] = await db()
      .insert(geracoesIA)
      .values({
        tarefa: "e2e-admin-protegido",
        versaoPrompt: "0",
        modelo: "mock",
        clienteId,
        entradas: { marcador: MARCA_UNICA_GERACAO },
      })
      .returning();
    geracaoId = geracao.id;
  });

  test("clientes/[id]: so a sessao de admin ve o nome e o e-mail do cliente", async ({ page, request }) => {
    await provarQueSoAdminVe(
      page,
      request,
      `/admin/clientes/${clienteId}`,
      [`/admin/clientes/${clienteId}`, `/admin/clientes/${clienteId}.0`],
      [clienteNome, clienteEmail],
    );
  });

  test("geracoes/[id]: so a sessao de admin ve a entrada da geracao", async ({ page, request }) => {
    await provarQueSoAdminVe(
      page,
      request,
      `/admin/geracoes/${geracaoId}`,
      [`/admin/geracoes/${geracaoId}`, `/admin/geracoes/${geracaoId}.0`],
      [MARCA_UNICA_GERACAO],
    );
  });

  test("nichos/[slug]: so a sessao de admin ve a conta vigiada", async ({ page, request }) => {
    await provarQueSoAdminVe(page, request, `/admin/nichos/${nichoSlug}`, [`/admin/nichos/${nichoSlug}`], [
      contaVigiadaHandle,
    ]);
  });
});
