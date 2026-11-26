/**
 * E74 PR 1 (pedido do Gustavo em 25/11/2026: "quando você gera roteiro, a parte de voltar não tá funcionando"): enquanto a
 * IA escreve as três versões (de 30 segundos a uns 2 minutos), o "Voltar depois" e o voltar do navegador (o gesto do iPhone)
 * precisam funcionar na hora. A causa era a espera rodar dentro de `useTransition`: uma transição assíncrona do React 19
 * segura todas as outras, e o `router.push` do "Voltar depois" ficava na fila até o servidor terminar.
 *
 * O servidor do e2e responde rápido (IA simulada); o teste segura a RESPOSTA da Server Action por `ESPERA_MS` (o pedido
 * chega ao servidor e o roteiro é gravado de verdade; só a resposta demora), que é o que a tela vê numa geração lenta.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq, like } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  temasDia,
  versoesDoRoteiro,
  user,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const ESPERA_MS = 12_000;
const SENHA = "ExemploSenha123";
const EMAIL = "e2e-voltar-gerando@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("E74 PR 1: o voltar funciona enquanto o roteiro é escrito", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-voltar-gerando"));
    if (jaExiste) return;

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-voltar-gerando", nome: "[teste] Objetivo voltar depois" })
      .returning();

    await db().insert(user).values({ id: "e2e-voltar-gerando", name: "[teste] Oficina", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-voltar-gerando-credential",
        issuer: "local:credential",
        accountId: "e2e-voltar-gerando",
        providerId: "credential",
        userId: "e2e-voltar-gerando",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-voltar-gerando", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-voltar-gerando", nome: "[teste] Oficina", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-voltar-gerando", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
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

    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  /** As versões desta marca de teste (nunca as do banco inteiro: outros arquivos de e2e escrevem versões também). */
  async function versoesDaMarca() {
    const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-voltar-gerando"));
    return db().select({ id: versoesDoRoteiro.id }).from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marca.id));
  }

  /** Segura a resposta da Server Action (o servidor já a processou); devolve um aviso de quando ela foi liberada. */
  async function segurarARespostaDaAcao(page: Page) {
    const estado = { liberada: false };
    let segurou = false;
    await page.route("**/*", async (rota) => {
      const pedido = rota.request();
      // Só a Server Action que escreve (o corpo leva o `origem` do pedido; a sugestão de estilo, que a tela pede ao montar, e as conferências de depois passam direto).
      if (!segurou && pedido.method() === "POST" && pedido.headers()["next-action"] && (pedido.postData() ?? "").includes('"origem"')) {
        segurou = true;
        const resposta = await rota.fetch();
        await new Promise((resolve) => setTimeout(resolve, ESPERA_MS));
        estado.liberada = true;
        await rota.fulfill({ response: resposta });
        return;
      }
      await rota.continue();
    });
    return estado;
  }

  async function comecarAEscrever(page: Page) {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
    const pedidoDeEscrever = page.waitForRequest((p) => p.method() === "POST" && (p.postData() ?? "").includes('"origem"'));
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page.getByText("Escrevendo as três versões")).toBeVisible();
    // A pessoa só sai depois de o pedido ter ido ao servidor (como no uso real: a espera dura minutos).
    await pedidoDeEscrever;
    await expect(page.getByText("Pode sair desta tela")).toBeVisible();
  }

  test("'Voltar depois' leva ao Hoje na hora, sem esperar a IA terminar", async ({ page }) => {
    test.setTimeout(60_000);
    const estado = await segurarARespostaDaAcao(page);
    await comecarAEscrever(page);
    await page.getByRole("button", { name: "Voltar depois" }).click();
    await expect(page).toHaveURL(/\/hoje$/, { timeout: 4000 });
    expect(estado.liberada).toBe(false);
    // O roteiro continua sendo escrito no servidor: as três versões estão no banco, e a resposta tardia não leva a pessoa de volta.
    await expect.poll(async () => (await versoesDaMarca()).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    await expect.poll(() => estado.liberada, { timeout: ESPERA_MS + 5000 }).toBe(true);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/hoje$/);
    // O Hoje conferiu a escrita enquanto ela corria (de 5 em 5 s) e nada pediu a escrita de novo: continuam só as três versões (uma escrita paga uma vez).
    expect(await versoesDaMarca()).toHaveLength(3);
  });

  test("o voltar do navegador funciona durante a espera e a resposta tardia não puxa a pessoa de volta", async ({ page }) => {
    test.setTimeout(60_000);
    const estado = await segurarARespostaDaAcao(page);
    await entrar(page);
    await page.goto("/hoje");
    await page.goto("/criar/objetivo?tema=0");
    await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
    const pedidoDeEscrever = page.waitForRequest((p) => p.method() === "POST" && (p.postData() ?? "").includes('"origem"'));
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page.getByText("Escrevendo as três versões")).toBeVisible();
    // A pessoa só sai depois de o pedido ter ido ao servidor (como no uso real: a espera dura minutos).
    await pedidoDeEscrever;
    await page.goBack();
    await expect(page).toHaveURL(/\/hoje$/, { timeout: 4000 });
    await expect(page.getByText("Escrevendo as três versões")).toHaveCount(0);
    await expect.poll(() => estado.liberada, { timeout: ESPERA_MS + 5000 }).toBe(true);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/hoje$/);
  });

  test("quem volta à tela com a escrita correndo vê que ainda está sendo escrito, e as versões abrem quando ficam prontas", async ({ page }) => {
    test.setTimeout(60_000);
    await segurarARespostaDaAcao(page);
    await comecarAEscrever(page);
    await page.getByRole("button", { name: "Voltar depois" }).click();
    await expect(page).toHaveURL(/\/hoje$/, { timeout: 4000 });
    await page.goto("/criar/objetivo?tema=0");
    // Não oferece escrever de novo (seria pagar duas vezes): mostra a espera e, quando o servidor terminou, abre a comparação.
    await expect(page.getByText("Escrevendo as três versões")).toBeVisible();
    await expect(page.getByRole("button", { name: "escrever o roteiro" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/criar\/versoes\//, { timeout: 30_000 });
  });

  test("no caminho feliz, o formulário não volta enquanto a página das versões carrega (um toque nele pagaria uma segunda escrita)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route("**/criar/versoes/**", async (rota) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await rota.continue();
    });
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    // A escrita (IA simulada) termina em instantes e a página nova demora 3 s: nesse meio tempo a espera fica na tela, nunca o botão de escrever.
    const fim = Date.now() + 2500;
    while (Date.now() < fim) {
      expect(await page.getByRole("button", { name: "escrever o roteiro" }).count()).toBe(0);
      await page.waitForTimeout(150);
    }
    expect(page.url()).toContain("/criar/objetivo");
    await expect(page).toHaveURL(/\/criar\/versoes\//, { timeout: 15_000 });
  });

  test.describe("a escrita falha com a pessoa fora da tela", () => {
    test.afterEach(async () => {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-voltar-gerando"));
      await db().delete(versoesDoRoteiro).where(and(eq(versoesDoRoteiro.clienteId, marca.id), like(versoesDoRoteiro.grupo, "enche-%")));
    });

    test("quem volta (pelo voltar do navegador) vê o erro de sempre, não 'ainda escrevendo' até o prazo", async ({ page }) => {
      test.setTimeout(60_000);
      // O teto do dia: 18 versões já escritas hoje e as três novas passam de 20, então o servidor recusa.
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-voltar-gerando"));
      await db()
        .insert(versoesDoRoteiro)
        .values(
          Array.from({ length: 18 }, (_, i) => ({
            clienteId: marca.id,
            grupo: `enche-${i}`,
            ordem: 1,
            parametros: {},
            valores: {},
            criadoEm: new Date(Date.now() - 60_000),
          })),
        );
      const estado = await segurarARespostaDaAcao(page);
      await entrar(page);
      await page.goto("/hoje");
      await page.goto("/criar/objetivo?tema=0");
      await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
      const pedidoDeEscrever = page.waitForRequest((p) => p.method() === "POST" && (p.postData() ?? "").includes('"origem"'));
      await page.getByRole("button", { name: "escrever o roteiro" }).click();
      await pedidoDeEscrever;
      await page.getByRole("button", { name: "Voltar depois" }).click();
      await expect(page).toHaveURL(/\/hoje$/, { timeout: 4000 });
      await expect.poll(() => estado.liberada, { timeout: ESPERA_MS + 5000 }).toBe(true);
      await page.waitForTimeout(500);
      await page.goBack();
      await expect(page).toHaveURL(/\/criar\/objetivo/);
      await expect(page.getByRole("alert").filter({ hasText: "limite de versões de hoje" })).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("Escrevendo as três versões")).toHaveCount(0);
    });
  });

  test("sair de um tema, escrever outro e voltar ao primeiro não abre a comparação do outro", async ({ page }) => {
    test.setTimeout(90_000);
    await segurarARespostaDaAcao(page);
    await comecarAEscrever(page);
    await page.getByRole("button", { name: "Voltar depois" }).click();
    await expect(page).toHaveURL(/\/hoje$/, { timeout: 4000 });
    // O outro tema: a escrita (que não é segurada) termina e abre as versões dele.
    await page.goto("/criar/objetivo?tema=1");
    await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/criar\/versoes\//, { timeout: 30_000 });
    const versoesDoOutro = page.url();
    // De volta ao primeiro, com a escrita dele ainda guardada como em andamento: as versões do segundo tema não servem.
    await page.goto("/criar/objetivo?tema=0");
    await expect(page.getByText("Escrevendo as três versões")).toBeVisible();
    await page.waitForTimeout(9000);
    expect(page.url()).not.toContain("/criar/versoes/");
    expect(page.url()).toContain("/criar/objetivo?tema=0");
    expect(versoesDoOutro).toContain("/criar/versoes/");
  });

  test("o Hoje mostra que as versões estão sendo escritas e o cartão muda sozinho para 'prontas', sem recarregar", async ({ page }) => {
    test.setTimeout(60_000);
    const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-voltar-gerando"));
    const linha = (ordem: number) => ({
      clienteId: marca.id,
      grupo: "escrevendo-1",
      ordem,
      parametros: {},
      valores: { tema: "tema de teste 1", objetivo: "alcance", formato: "reels", estilo: "falado", conteudo: {} },
    });
    try {
      // O servidor já gravou a primeira versão e ainda escreve as outras duas.
      await db().insert(versoesDoRoteiro).values(linha(1));
      await entrar(page);
      await expect(page.locator("[data-versoes-escrevendo]")).toBeVisible();
      await expect(page.locator("[data-versoes-prontas]")).toHaveCount(0);
      await db().insert(versoesDoRoteiro).values([linha(2), linha(3)]);
      await expect(page.locator("[data-versoes-prontas]")).toContainText("Três versões prontas", { timeout: 20_000 });
      await expect(page.locator("[data-versoes-escrevendo]")).toHaveCount(0);
    } finally {
      await db().delete(versoesDoRoteiro).where(and(eq(versoesDoRoteiro.clienteId, marca.id), like(versoesDoRoteiro.grupo, "escrevendo-%")));
    }
  });
});
