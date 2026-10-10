/**
 * As versões do roteiro (E26 4b, parte 2; `Objetivo.dc.html`, estados `comparar`, `gerandoOutra`, `quatroVersoes`, e `Hoje.dc.html`, `versoesProntas`): "escrever o roteiro" escreve três versões
 * do tema com as três notas, a pessoa lê o roteiro inteiro de cada uma e fica com uma (só então nasce o roteiro), "Gerar outra" escreve mais uma (a "Nova", no fim), no celular a lista
 * abre uma por vez, e quem sai na espera encontra as versões prontas no Hoje.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { count, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, temasDia, user, versoesDoRoteiro, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const NICHO = "e2e-versoes";
const MARCAS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
type Marca = (typeof MARCAS)[number];

const idDe = (m: Marca) => `e2e-versoes-${m}`;
const emailDe = (m: Marca) => `${idDe(m)}@exemplo.teste`;

async function entrar(page: Page, marca: Marca) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(emailDe(marca));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

async function clienteDe(marca: Marca) {
  const [c] = await db().select().from(clientes).where(eq(clientes.usuarioId, idDe(marca)));
  return c;
}

async function totalDeRoteiros(marca: Marca): Promise<number> {
  const c = await clienteDe(marca);
  const [{ total }] = await db().select({ total: count() }).from(roteiros).where(eq(roteiros.clienteId, c.id));
  return total;
}

/** A pessoa pede o roteiro do tema 0 com a ficha "Que me chamem" e espera as versões. */
async function pedirAsVersoes(page: Page): Promise<string> {
  await page.goto("/criar/objetivo?tema=0");
  await page.locator("[data-fichas]").getByRole("radio", { name: /Que me chamem/ }).click();
  await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
  await expect(page).toHaveURL(/\/criar\/versoes\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe("as versões do roteiro", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, NICHO));
    if (jaExiste) return;
    const [nicho] = await db().insert(nichos).values({ slug: NICHO, nome: "[teste] Versões" }).returning();
    const temas: TemaDoDia[] = [
      { titulo: "o erro que faz a mancha voltar", descricao: "d1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "d2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "d3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
    for (const m of MARCAS) {
      const id = idDe(m);
      await db().insert(user).values({ id, name: `[teste] Versões ${m}`, email: emailDe(m) });
      await db().insert(account).values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
      await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
      const [marca] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] Versões ${m}`, nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: id, clienteId: marca.id, papel: "dono" });
      await db().insert(briefings).values({
        clienteId: marca.id,
        completo: true,
        perfil: {
          fatos: { oQueVende: "lavagem de estofados", preco: "sofá de 3 lugares por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
          resumo: "lava estofados em domicílio",
          referencias: [],
        },
      });
    }
  });

  test("três versões com as notas, o roteiro inteiro de cada uma, e nenhuma é roteiro até a pessoa escolher", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, "a");
    const antes = await totalDeRoteiros("a");
    await pedirAsVersoes(page);

    const folhas = page.locator("article[data-versao]");
    await expect(folhas).toHaveCount(3);
    await expect(folhas.nth(0)).toContainText("Versão 1 de 3");
    await expect(folhas.nth(0)).toContainText("Nota mais alta");
    await expect(page.getByText("Ordenadas pela chance de te chamarem para comprar, que é o objetivo que você escolheu.")).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await expect(folhas.nth(i)).toContainText("Chance de te chamarem para comprar");
      await expect(folhas.nth(i)).toContainText("é o que você escolheu");
      await expect(folhas.nth(i).getByRole("list", { name: "O roteiro" })).toBeVisible();
      await expect(folhas.nth(i).getByRole("button", { name: "Ficar com esta" })).toBeVisible();
    }
    // Sem jargão do objetivo antigo na tela.
    const texto = (await page.locator("main").innerText()).toLowerCase();
    for (const proibida of ["engajamento", "alcance", "conversão"]) expect(texto).not.toContain(proibida);

    // Nenhuma versão é roteiro: a agenda, o Histórico e o resto não ganham nada.
    expect(await totalDeRoteiros("a")).toBe(antes);

    // Ficar com a segunda: o roteiro dela abre, e só ele nasce.
    const nome = (await folhas.nth(1).getByRole("heading", { level: 3 }).innerText()).trim();
    await folhas.nth(1).getByRole("button", { name: "Ficar com esta" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(nome);
    expect(await totalDeRoteiros("a")).toBe(antes + 1);
  });

  test("depois de ficar com uma, o roteiro diz que as outras continuam guardadas e leva de volta a elas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, "g");
    await pedirAsVersoes(page);
    const folhas = page.locator("article[data-versao]");
    await folhas.nth(0).getByRole("button", { name: "Ficar com esta" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 30_000 });
    const roteiroUrl = page.url();

    const secao = page.locator("section", { hasText: "Outras versões deste tema" });
    await expect(secao).toContainText("Você recebeu três versões deste tema e ficou com esta.");
    await secao.getByRole("link", { name: "Ver as outras versões" }).click();
    await expect(page).toHaveURL(/\/criar\/versoes\/[0-9a-f-]{36}/);
    await expect(folhas).toHaveCount(3);
    // A que virou roteiro leva o selo e o caminho de volta; o Hoje não mostra mais o cartão (a pessoa já resolveu).
    const escolhida = folhas.filter({ hasText: "Escolhida" });
    await expect(escolhida).toHaveCount(1);
    await expect(escolhida.getByRole("link", { name: "Abrir o roteiro" })).toHaveAttribute("href", new URL(roteiroUrl).pathname);
    await page.goto("/hoje");
    await expect(page.locator("[data-versoes-prontas]")).toHaveCount(0);
  });

  test("Gerar outra escreve a quarta, marcada Nova, no fim, sem mexer nas três", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, "b");
    await pedirAsVersoes(page);
    const folhas = page.locator("article[data-versao]");
    await expect(folhas).toHaveCount(3);
    const nomesAntes = await folhas.getByRole("heading", { level: 3 }).allInnerTexts();

    await page.getByRole("button", { name: "Gerar outra" }).click();
    // Enquanto escreve: a folha da quarta com o aviso, e as três continuam.
    await expect(page.getByText("Escrevendo outra versão")).toBeVisible();
    await expect(folhas).toHaveCount(4, { timeout: 60_000 });
    await expect(folhas.nth(3)).toContainText("Versão 4 de 4");
    await expect(folhas.nth(3)).toContainText("Nova");
    expect(await folhas.getByRole("heading", { level: 3 }).allInnerTexts()).toEqual([...nomesAntes, expect.any(String)]);
    expect(await totalDeRoteiros("b")).toBe(0);

    const grupo = new URL(page.url()).pathname.split("/").pop()!;
    const [{ total }] = await db().select({ total: count() }).from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, grupo));
    expect(total).toBe(4);
  });

  test("no celular, a lista abre uma versão por vez e o Ficar com esta vem com ela", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "c");
    await pedirAsVersoes(page);
    const folhas = page.locator("article[data-versao]");
    await expect(folhas).toHaveCount(3);

    // A de nota mais alta vem aberta: o roteiro e o botão aparecem só nela.
    await expect(folhas.nth(0).getByRole("list", { name: "O roteiro" })).toBeVisible();
    await expect(folhas.nth(0).getByRole("button", { name: "Ficar com esta" })).toBeVisible();
    await expect(folhas.nth(1).getByRole("list", { name: "O roteiro" })).toBeHidden();
    await expect(folhas.nth(1).getByRole("button", { name: "Ficar com esta" })).toBeHidden();

    await folhas.nth(1).getByRole("button", { name: "Ler esta versão inteira" }).click();
    await expect(folhas.nth(1).getByRole("list", { name: "O roteiro" })).toBeVisible();
    await expect(folhas.nth(0).getByRole("list", { name: "O roteiro" })).toBeHidden();
    await expect(folhas.nth(1).getByRole("button", { name: "Ficar com esta" })).toBeVisible();

    // Nada transborda para o lado.
    const largura = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, janela: window.innerWidth }));
    expect(largura.scroll).toBeLessThanOrEqual(largura.janela);
  });

  test("a página não transborda em nenhum tamanho, e no tablet as folhas passam de lado por dentro do trilho", async ({ page }) => {
    await entrar(page, "h");
    await page.setViewportSize({ width: 1280, height: 900 });
    await pedirAsVersoes(page);
    const trilho = page.getByRole("group", { name: "As 3 versões" });
    for (const largura of [360, 390, 768, 820, 1024, 1180, 1280]) {
      await page.setViewportSize({ width: largura, height: 900 });
      await expect(trilho).toBeVisible();
      const medidas = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, janela: window.innerWidth }));
      expect(medidas.pagina, `a ${largura}px a página tem rolagem de lado`).toBeLessThanOrEqual(medidas.janela);
    }
    // Do tablet em pé até antes de 1180, o trilho rola de lado por dentro: tem mais folhas do que cabe.
    await page.setViewportSize({ width: 820, height: 900 });
    const rola = await trilho.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(rola).toBe(true);
    // Do 1180 para cima, as três cabem lado a lado, sem rolagem do trilho.
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await trilho.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("quem sai na espera encontra as versões prontas no Hoje quando ficam prontas, e o cartão some quando escolhe", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, "d");
    await page.goto("/criar/objetivo?tema=0");
    await page.locator("[data-fichas]").getByRole("radio", { name: /Que me chamem/ }).click();
    // O pedido fica parado por uns segundos, para a pessoa sair na espera ("Voltar depois"); o servidor escreve as versões quando o pedido chega.
    await page.route("**/criar/objetivo*", async (rota) => {
      if (rota.request().method() === "POST") await new Promise((resolver) => setTimeout(resolver, 4000));
      await rota.continue();
    });
    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
    await page.getByRole("button", { name: "Voltar depois" }).click({ timeout: 12_000 });
    await expect(page).toHaveURL(/\/hoje$/);

    // Recarrega até as três ficarem prontas: antes disso não há cartão (a pessoa não cai numa comparação pela metade).
    const cartao = page.locator("[data-versoes-prontas]");
    await expect(async () => {
      await page.reload();
      await expect(cartao).toContainText("Três versões prontas", { timeout: 3000 });
    }).toPass({ timeout: 60_000 });
    await page.unroute("**/criar/objetivo*");
    await expect(cartao).toContainText("Suas versões estão prontas");
    await expect(cartao).toContainText("o erro que faz a mancha voltar");
    await expect(cartao).toContainText("Para que te chamem");
    await cartao.getByRole("button", { name: "Escolher uma" }).click();
    await expect(page).toHaveURL(/\/criar\/versoes\/[0-9a-f-]{36}$/);
    await expect(page.locator("article[data-versao]")).toHaveCount(3);

    await page.locator("article[data-versao]").first().getByRole("button", { name: "Ficar com esta" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 30_000 });

    await page.goto("/hoje");
    await expect(page.locator("[data-versoes-prontas]")).toHaveCount(0);
  });

  test("Trocar o objetivo volta ao objetivo do mesmo tema, e o grupo de outra marca não abre", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, "e");
    const grupo = await pedirAsVersoes(page);
    await page.getByRole("link", { name: "Trocar o objetivo" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0/);

    // Outra marca, mesma URL: cai no Criar, sem mostrar nada da primeira.
    const contexto = await browser.newContext();
    const outra = await contexto.newPage();
    await entrar(outra, "f");
    await outra.goto(`/criar/versoes/${grupo}`);
    await expect(outra).toHaveURL(/\/criar$/);
    await contexto.close();
  });
});
