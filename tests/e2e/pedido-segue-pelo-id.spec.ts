/**
 * E74 PR 2a (R-a, R-i; teste 2 da seção 6 de `estrategia/e74-aba-em-andamento.md`): o achado do Fable de 26/11. No iPhone, bloquear a tela ou trocar de app derrubava a resposta da escrita
 * com o servidor ainda escrevendo; a tela mostrava "A conexão caiu no meio" com "Tentar de novo", e quem tocava ali pagava duas vezes. Aqui o pedido chega ao servidor e a escrita acontece; a
 * resposta é que se perde, e a rede some por um tempo. A tela continua na espera (sem "a conexão caiu", sem "Tentar de novo"), pergunta pelo pedido quando a pessoa volta e abre as versões do
 * PRÓPRIO pedido. No banco: um pedido, um grupo, três versões.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, pedidosDeGeracao, preferenciasUsuario, temasDia, user, versoesDoRoteiro, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { textosObjetivo } from "../../src/textos/objetivo";
import { textosPedidos } from "../../src/textos/pedidos";

const SENHA = "ExemploSenha123";
const USUARIO = "e2e-pedido-pelo-id";
const EMAIL = "e2e-pedido-pelo-id@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

let marcaId = 0;

test.describe("E74 PR 2a: a resposta da escrita se perde com o servidor escrevendo", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright: a marca de uma rodada anterior é reaproveitada, com os pedidos e as versões dela apagados.
    const [jaExiste] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, USUARIO));
    if (jaExiste) {
      marcaId = jaExiste.id;
      await db().delete(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaId));
      await db().delete(pedidosDeGeracao).where(eq(pedidosDeGeracao.clienteId, marcaId));
      return;
    }

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-pedido-pelo-id", nome: "[teste] Pedido pelo id" }).returning();
    await db().insert(user).values({ id: USUARIO, name: "[teste] Lavanderia", email: EMAIL });
    await db()
      .insert(account)
      .values({ id: `${USUARIO}-credential`, issuer: "local:credential", accountId: USUARIO, providerId: "credential", userId: USUARIO, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: USUARIO, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: USUARIO, nome: "[teste] Lavanderia", nichoId: nicho.id }).returning();
    marcaId = marca.id;
    await db().insert(membrosMarca).values({ usuarioId: USUARIO, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofa de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicilio",
        referencias: [],
      },
    });
    const temas: TemaDoDia[] = [
      { titulo: "mancha de vinho no sofa", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "cheiro de bicho no sofa", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "sofa de tecido claro", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("a tela segue o pedido pelo id, nunca oferece pagar de novo, e abre as versões do próprio pedido", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    await page.waitForLoadState("networkidle");
    const escolha = page.getByRole("radio", { name: /Que me chamem/ });
    await expect(async () => {
      await escolha.click();
      await expect(escolha).toBeChecked({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    let cortou = false;
    await page.route("**/*", async (rota) => {
      const pedido = rota.request();
      if (!cortou && pedido.method() === "POST" && pedido.headers()["next-action"]) {
        cortou = true;
        // O pedido chega ao servidor e a escrita acontece inteira; a resposta é que não volta (a tela bloqueada no iPhone).
        await rota.fetch().catch(() => null);
        await page.context().setOffline(true);
        await rota.abort("internetdisconnected");
        return;
      }
      await rota.continue();
    });

    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
    await expect(page.getByText(textosObjetivo.esperaVersoesTitulo)).toBeVisible();
    // Sem rede: a espera continua e diz isso; nada de "a conexão caiu", nada de "Tentar de novo" (R-a).
    await expect(page.getByText(textosPedidos.semRede)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(textosObjetivo.conexaoCaiuNoMeio)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);

    await page.unroute("**/*");
    await context.setOffline(false);
    // A pessoa volta ao app: a tela pergunta na hora (R-i) e abre as versões que o servidor já escreveu.
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await expect(page).toHaveURL(/\/criar\/versoes\//, { timeout: 30_000 });

    // Uma escrita só: um pedido, pronto, e o grupo dele com as três versões.
    const pedidos = await db().select().from(pedidosDeGeracao).where(eq(pedidosDeGeracao.clienteId, marcaId));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].estado).toBe("pronto");
    expect(page.url()).toContain(`/criar/versoes/${pedidos[0].resultadoId}`);
    const versoes = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaId));
    expect(versoes).toHaveLength(3);
    expect(new Set(versoes.map((v) => v.grupo))).toEqual(new Set([pedidos[0].resultadoId]));
  });
});
