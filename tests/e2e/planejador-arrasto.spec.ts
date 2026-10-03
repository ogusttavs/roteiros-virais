/**
 * E39c, parte 2b: mover um item de dia arrastando, na Semana e no Mês, do tablet deitado para
 * cima (1024px ou mais); o caminho pelo teclado (o menu de três ações, "Não vou gravar hoje", a
 * folha "Mudar o dia") é o mesmo de sempre, só verificado aqui onde esta etapa mexeu (a visão
 * Mês, que não tinha o menu). Os dias ficam bem à frente de hoje (A3, abaixo), para o teste nunca
 * cair perto de "hoje" de verdade e um dia virar "passado" sozinho com o tempo.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-planejador-arrasto@exemplo.teste";

/**
 * A3: a visão Semana é a janela de sete dias a partir de hoje (blocos de sete contados de hoje), então os dias do teste saem de um bloco bem à frente (mais de
 * dez semanas, para nunca cair perto de "hoje") e do mesmo mês, calculados da data de hoje: o início do bloco, mais 1, 3 e 4.
 */
function somar(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias, 12)).toISOString().slice(0, 10);
}
const INICIO_DO_BLOCO = (() => {
  const hoje = hojeISO();
  for (let blocos = 11; blocos < 20; blocos++) {
    const inicio = somar(hoje, blocos * 7);
    if (somar(inicio, 1).slice(0, 7) === somar(inicio, 4).slice(0, 7)) return inicio;
  }
  throw new Error("sem bloco de sete dias dentro de um mesmo mes");
})();
const DIA_ORIGEM = somar(INICIO_DO_BLOCO, 1);
const DIA_VAZIO = somar(INICIO_DO_BLOCO, 3);
const DIA_COM_REELS = somar(INICIO_DO_BLOCO, 4);
const MES_DO_TESTE = DIA_ORIGEM.slice(0, 7);

/** O nome do mês por extenso ("março"), para distinguir o dia 29 do mês do 29 do mês vizinho na grade. */
function nomeDoMes(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
}

/** O nome acessível da região de um dia na Semana: "quinta-feira, 11 de março" (o mesmo que a tela monta). */
function rotuloDoDia(dataISO: string): RegExp {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const texto = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
  return new RegExp(texto, "i"); // só letras, espaços, vírgula e dígitos: nada a escapar
}

const CONTEUDO_MINIMO = {
  titulo: "um titulo de roteiro de teste",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

let clienteId: number;

test.describe("planejador, mover de dia por arrasto (E39c, parte 2b)", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-planejador-arrasto"));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-planejador-arrasto"));
      clienteId = marca.id;
      return;
    }

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-planejador-arrasto", nome: "[teste] Planejador arrasto" }).returning();
    await db().insert(user).values({ id: "e2e-planejador-arrasto", name: "[teste] Planejador arrasto", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-planejador-arrasto-credential",
        issuer: "local:credential",
        accountId: "e2e-planejador-arrasto",
        providerId: "credential",
        userId: "e2e-planejador-arrasto",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-planejador-arrasto", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-planejador-arrasto", nome: "[teste] Planejador arrasto", nichoId: nicho.id })
      .returning();
    clienteId = marca.id;
    await db().insert(membrosMarca).values({ usuarioId: "e2e-planejador-arrasto", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofá de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
  });

  test.beforeEach(async () => {
    await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
    await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: DIA_ORIGEM,
        tema: "o item que vai ser arrastado",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: { ...CONTEUDO_MINIMO, titulo: "o item que vai ser arrastado" },
        status: "gerado",
      });
    await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: DIA_COM_REELS,
        tema: "ja tem um reels aqui",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: { ...CONTEUDO_MINIMO, titulo: "ja tem um reels aqui" },
        status: "gerado",
      });
  });

  test("Semana, 1280px: arrastar para um dia vazio move na hora, sem perguntar nada", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("region", { name: rotuloDoDia(DIA_VAZIO) });
    await expect(origem).toBeVisible();
    await expect(destino).toBeVisible();
    // Hidratada antes de arrastar: o arrasto que começa antes dos manipuladores existirem não faz nada (oscilou sob carga na CI).
    await page.waitForLoadState("networkidle");

    await origem.dragTo(destino);

    await expect(page.getByRole("region", { name: rotuloDoDia(DIA_VAZIO) }).getByText("o item que vai ser arrastado")).toBeVisible();
    await expect(page.getByRole("region", { name: rotuloDoDia(DIA_ORIGEM) }).getByText("o item que vai ser arrastado")).toHaveCount(0);
  });

  test("Semana, 1280px: arrastar para um dia que já tem um Reels pede confirmação antes de mover", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("region", { name: rotuloDoDia(DIA_COM_REELS) });
    await expect(origem).toBeVisible();
    await expect(destino).toBeVisible();
    // Hidratada antes de arrastar (oscilou sob carga na CI).
    await page.waitForLoadState("networkidle");
    await origem.dragTo(destino);

    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao).toBeVisible();
    await expect(confirmacao).toContainText("Reels");

    // Cancelar não move nada.
    await confirmacao.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirmacao).toBeHidden();
    await expect(page.getByRole("region", { name: rotuloDoDia(DIA_ORIGEM) }).getByText("o item que vai ser arrastado")).toBeVisible();

    // Arrastar de novo e confirmar move de verdade.
    await origem.dragTo(destino);
    await page.getByRole("alertdialog").getByRole("button", { name: "Mover mesmo assim" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByRole("region", { name: rotuloDoDia(DIA_COM_REELS) }).getByText("o item que vai ser arrastado")).toBeVisible();
  });

  test("Semana, 390px: sem arrasto no celular, o caminho continua sendo o menu de três ações", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    // Abaixo de 1024px o gesto de arrasto é cancelado no `dragstart` (`useMoverDeDia.ts`); o
    // item tem que continuar no mesmo dia depois da tentativa.
    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("region", { name: rotuloDoDia(DIA_VAZIO) });
    await origem.dragTo(destino, { force: true }).catch(() => {});
    await expect(page.getByRole("region", { name: rotuloDoDia(DIA_ORIGEM) }).getByText("o item que vai ser arrastado")).toBeVisible();

    await origem.getByRole("button", { name: /Mais opções/ }).click();
    await page.getByRole("menuitem", { name: "Não vou gravar hoje" }).click();
    await expect(page.getByRole("dialog", { name: "Mudar o dia" })).toBeVisible();
  });

  test("Mês, 1280px: arrastar da lista do dia selecionado para outra célula do mês", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=mes&mes=${MES_DO_TESTE}&dia=${DIA_ORIGEM}`);

    const origem = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    const destino = page.getByRole("button", { name: new RegExp(`\\b${Number(DIA_VAZIO.slice(8))} de ${nomeDoMes(DIA_VAZIO)}`, "i") });
    await expect(origem).toBeVisible();

    await origem.dragTo(destino);

    // O dia 9 continua selecionado: espera na própria página até o `router.refresh()` esvaziar a
    // lista dele, antes de navegar para o dia 11 (navegar cedo demais corre com a escrita no banco).
    await expect(page.getByText("o item que vai ser arrastado")).toHaveCount(0);

    await page.goto(`/planejamento?visao=mes&mes=${MES_DO_TESTE}&dia=${DIA_VAZIO}`);
    await expect(page.getByText("o item que vai ser arrastado")).toBeVisible();
  });

  test("Mês: o menu de três ações chega na lista do dia selecionado (pendência da parte 2a)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);
    await page.goto(`/planejamento?visao=mes&mes=${MES_DO_TESTE}&dia=${DIA_ORIGEM}`);

    const linha = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    await linha.getByRole("button", { name: /Mais opções/ }).click();
    await expect(page.getByRole("menuitem", { name: "Não vou gravar hoje" })).toBeVisible();
  });

  test("Semana, 390px: o menu também pergunta antes de mover para um dia que já tem o mesmo formato", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await entrar(page);
    await page.goto(`/planejamento?visao=semana&dia=${DIA_ORIGEM}`);

    const linha = page.getByRole("listitem").filter({ hasText: "o item que vai ser arrastado" });
    await linha.getByRole("button", { name: /Mais opções/ }).click();
    await page.getByRole("menuitem", { name: "Não vou gravar hoje" }).click();

    const folha = page.getByRole("dialog", { name: "Mudar o dia" });
    await expect(folha).toBeVisible();
    await folha.getByRole("button", { name: "Escolher a data", exact: true }).click();
    await folha.getByLabel("Escolher a data").fill(DIA_COM_REELS);
    await folha.getByRole("button", { name: "Salvar", exact: true }).click();

    // A folha some e a pergunta aparece no lugar dela, mesmo texto e mesmos botões do arrasto.
    await expect(folha).toBeHidden();
    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao).toBeVisible();
    await expect(confirmacao).toContainText("Reels");

    await confirmacao.getByRole("button", { name: "Mover mesmo assim" }).click();
    await expect(confirmacao).toBeHidden();
    await expect(page.getByRole("region", { name: rotuloDoDia(DIA_COM_REELS) }).getByText("o item que vai ser arrastado")).toBeVisible();
  });
});
