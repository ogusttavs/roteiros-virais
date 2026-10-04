/**
 * `/hoje`, a Agenda (E39a, design v2, `Hoje.dc.html`, estados `agenda`, `agendaVazia`,
 * `agendaOutroDia`): o dia de hoje com o Reels em destaque e os Stories na ordem do momento, um
 * dia vazio levando para `/criar`, e um dia que não é hoje com "Marcado para" e o estado
 * "marcado". A prova de "para quando é" (dúvida 10, Criar.dc.html) fica no teste que escreve de
 * verdade pelo navegador e confere o dia gravado no banco, para não depender de em que dia da
 * semana a suíte roda (o resto grava os roteiros direto no banco, mesma lição de
 * `temas-do-dia.spec.ts`).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  temasDia,
  user,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const CONTEUDO_MINIMO = {
  titulo: "titulo do roteiro",
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

type OpcoesRoteiro = {
  formato: "reels" | "story";
  momentoDoDia?: "manha" | "meio_dia" | "fim_tarde" | "noite";
  titulo: string;
  status?: "gerado" | "gravado" | "postado";
};

async function criarRoteiro(clienteId: number, data: string, opcoes: OpcoesRoteiro) {
  await db()
    .insert(roteiros)
    .values({
      clienteId,
      data,
      tema: `tema de ${opcoes.titulo}`,
      origem: "sugerido",
      objetivo: "engajamento",
      formato: opcoes.formato,
      momentoDoDia: opcoes.momentoDoDia,
      conteudo: { ...CONTEUDO_MINIMO, titulo: opcoes.titulo },
      status: opcoes.status ?? "gerado",
    });
}

function somarDias(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias, 12)).toISOString().slice(0, 10);
}

let nichoId: number;

/** `testId` do Playwright (único por teste, estável sob `fullyParallel`) em vez de um contador em
 * memória: um contador de módulo colidia entre testes deste arquivo (achado da prova local). E o número da
 * TENTATIVA (`retry`): o retry do Playwright roda o teste de novo e insere o mesmo usuário, e a chave duplicada
 * (`user_pkey`) matava a segunda tentativa, escondendo a falha de verdade (achado da CI do PR #110). */
async function criarMarca() {
  const usuarioId = `e2e-agenda-${test.info().testId}-r${test.info().retry}`;
  await db().insert(user).values({ id: usuarioId, name: "[teste] Agenda", email: `${usuarioId}@exemplo.teste` });
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
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: "[teste] Agenda", nichoId })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({
    clienteId: marca.id,
    completo: true,
    notaGeral: "8.50",
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
  return { usuarioId, marcaId: marca.id, email: `${usuarioId}@exemplo.teste` };
}

test.describe("/hoje, a Agenda", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, "e2e-agenda"));
    if (jaExiste) {
      nichoId = jaExiste.id;
      return;
    }
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-agenda", nome: "[teste] Agenda" }).returning();
    nichoId = nicho.id;
  });

  test("dia vazio: 'Criar roteiro' leva para /criar com a data do dia", async ({ page }) => {
    const { email } = await criarMarca();
    const hoje = hojeISO();
    await entrar(page, email);

    await expect(page.getByRole("heading", { name: "Nada marcado para hoje" })).toBeVisible();
    await page.getByRole("button", { name: "Criar roteiro" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar\\?data=${hoje}$`));
  });

  test("dia vazio com algo marcado para amanhã: o aviso 'o próximo marcado é amanhã' aparece (achado da revisão do PR #90, decisão 7: agenda.reels virou lista e o aviso nunca mais aparecia)", async ({
    page,
  }) => {
    const { marcaId, email } = await criarMarca();
    await criarRoteiro(marcaId, somarDias(hojeISO(), 1), { formato: "story", momentoDoDia: "manha", titulo: "story de amanha" });

    await entrar(page, email);

    await expect(page.getByRole("heading", { name: "Nada marcado para hoje" })).toBeVisible();
    await expect(page.getByText("O próximo marcado é amanhã: um Story.")).toBeVisible();
  });

  test("dia vazio que não é hoje: 'Criar roteiro' leva a data daquele dia, até o roteiro criado (decisão 5, PR #90)", async ({
    page,
  }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    const amanha = somarDias(hoje, 1);
    // `/criar` recusa data passada (decisão 5: `data >= hoje`); precisa ser um dia futuro dentro da faixa visível em /hoje. Desde o A3 a faixa é hoje e os seis dias
    // seguintes, então hoje + 2 sempre existe (antes, num sábado ou domingo a semana de segunda a domingo não deixava dia válido e o teste pulava).
    const dia = somarDias(hoje, 2);
    expect(dia).not.toBe(amanha);
    const temas: TemaDoDia[] = [
      { titulo: "tema do dia marcado", descricao: "descricao", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    // onConflictDoNothing: este nicho é compartilhado com o teste "escolher 'Amanhã'" acima, que
    // também grava temas do dia para hoje; o conteúdo exato não importa aqui, só que exista um tema.
    await db().insert(temasDia).values({ nichoId, data: hoje, temas }).onConflictDoNothing();

    await entrar(page, email);

    await page.goto(`/hoje?dia=${dia}`);
    await page.getByRole("button", { name: "Criar roteiro" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar\\?data=${dia}$`));

    await page.getByRole("button", { name: "Os temas de hoje" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/temas\\?data=${dia}$`));

    await page
      .getByRole("button", { name: "Quero esse" })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/criar/objetivo\\?tema=0&data=${dia}$`));

    await page.getByRole("radio", { name: /Que muita gente veja/ }).click();

    // A pessoa tocou em "Criar roteiro" no dia outroDia: "para quando é" já nasce marcado nele,
    // sem precisar escolher a data de novo (decisão 5 do Fable no PR #90).
    await expect(page.getByLabel("Escolher a data")).toHaveValue(dia);

    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    const [roteiroCriado] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(roteiroCriado.data).toBe(dia);
  });

  test("o Reels de hoje em destaque e os Stories na ordem do momento, manhã antes de meio do dia antes de noite", async ({
    page,
  }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, hoje, { formato: "reels", titulo: "o roteiro de reels de hoje" });
    await criarRoteiro(marcaId, hoje, { formato: "story", momentoDoDia: "noite", titulo: "story da noite" });
    await criarRoteiro(marcaId, hoje, { formato: "story", momentoDoDia: "manha", titulo: "story da manha", status: "postado" });
    await criarRoteiro(marcaId, hoje, { formato: "story", momentoDoDia: "meio_dia", titulo: "story do meio do dia" });

    await entrar(page, email);

    await expect(page.getByRole("heading", { name: "o roteiro de reels de hoje" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir o roteiro" })).toBeVisible();

    const itens = page.locator('[class*="itemAgenda"]');
    await expect(itens).toHaveCount(3);
    await expect(itens.nth(0)).toContainText("story da manha");
    await expect(itens.nth(0)).toContainText("postado");
    await expect(itens.nth(1)).toContainText("story do meio do dia");
    await expect(itens.nth(2)).toContainText("story da noite");
  });

  test("um dia que não é hoje: 'Marcado para', 'Voltar para hoje', e o item diz 'marcado'", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    const outroDia = somarDias(hoje, 3); // dentro da faixa de sete dias a partir de hoje (A3)
    await criarRoteiro(marcaId, outroDia, { formato: "reels", titulo: "o roteiro do outro dia" });

    await entrar(page, email);

    await page.goto(`/hoje?dia=${outroDia}`);
    await expect(page.getByText("Marcado para", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "o roteiro do outro dia" })).toBeVisible();
    await expect(page.getByText("marcado", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Voltar para hoje" }).click();
    await expect(page).toHaveURL(/\/hoje$/);
    await expect(page.getByText("Marcado para", { exact: true })).toHaveCount(0);
  });

  // A3, itens 1, 2 e 4: a faixa e a visão Semana começam em hoje (em qualquer dia da semana em que a suíte rode), as setas andam de sete em sete e ficam no lugar.
  test("a faixa do Hoje e a Semana do Planejar começam em hoje; as setas de sete em sete ficam fixas", async ({ page }) => {
    const { email } = await criarMarca();
    const hoje = hojeISO();

    await entrar(page, email);
    await page.waitForLoadState("networkidle");

    // Hoje: a primeira da faixa é hoje, e o rótulo diz "Próximos 7 dias".
    await expect(page.getByText("Próximos 7 dias", { exact: true })).toBeVisible();
    const faixa = page.getByRole("group", { name: "Os próximos 7 dias" }).getByRole("button");
    await expect(faixa).toHaveCount(7);
    const nomesCurtos = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const [ano, mes, dia] = hoje.split("-").map(Number);
    const dowHoje = new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay();
    await expect(faixa.first()).toContainText(nomesCurtos[dowHoje]);
    await expect(faixa.first()).toContainText(String(dia));

    // Planejar, Semana: hoje na primeira região, e as setas não saem do lugar entre uma semana e outra.
    await page.goto("/planejamento?visao=semana");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Próximos 7 dias", { exact: true })).toBeVisible();
    const regioes = page.locator('section[aria-label]').filter({ has: page.locator("h3") });
    await expect(regioes.first()).toHaveAttribute("aria-label", /, hoje$/);

    const seta = page.getByRole("button", { name: "Próximos 7 dias", exact: true });
    const antes = await seta.boundingBox();
    await seta.click();
    await expect(page).toHaveURL(new RegExp(`dia=${somarDias(hoje, 7)}`));
    await expect(page.getByText("Dias à frente", { exact: true })).toBeVisible();
    const depois = await page.getByRole("button", { name: "Próximos 7 dias", exact: true }).boundingBox();
    expect(Math.abs(depois!.x - antes!.x)).toBeLessThan(1);

    await page.getByRole("button", { name: "7 dias anteriores" }).click();
    await page.getByRole("button", { name: "7 dias anteriores" }).click();
    await expect(page).toHaveURL(new RegExp(`dia=${somarDias(hoje, -7)}`));
    await expect(page.getByText("Dias anteriores", { exact: true })).toBeVisible();
  });

  // E39c, parte 1, item 2: as setas da semana, sem limite, e "Ver o mês" carregando o dia visualizado
  // (para o mês abrir no lugar certo, não sempre no de hoje).
  test("as setas da semana andam sem limite, e 'Ver o mês' leva ao mês do dia visualizado", async ({ page }) => {
    const { email } = await criarMarca();
    const hoje = hojeISO();
    const diaDaquiA21Dias = somarDias(hoje, 21);

    await entrar(page, email);
    // O clique logo depois de carregar chegava antes da hidratação e se perdia (CI do PR #110): espera a tela assentar, e depois confere a URL a
    // CADA seta, em vez de três cliques seguidos (um clique perdido no meio fazia a URL final errada e o teste morria sem dizer onde).
    await page.waitForLoadState("networkidle");

    for (const semanas of [1, 2, 3]) {
      await page.getByRole("button", { name: "Próximos 7 dias", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`dia=${somarDias(hoje, 7 * semanas)}`));
    }
    await expect(page).toHaveURL(new RegExp(`dia=${diaDaquiA21Dias}`));

    await page.getByRole("button", { name: "Ver o mês" }).click();
    await expect(page).toHaveURL(new RegExp(`/planejamento\\?visao=mes&dia=${diaDaquiA21Dias}`));

    const diaDoMes = Number(diaDaquiA21Dias.split("-")[2]);
    const celulaSelecionada = page.getByRole("button", { name: new RegExp(`, ${diaDoMes} de `) }).and(page.getByRole("button", { pressed: true }));
    await expect(celulaSelecionada).toBeVisible();

    // Volta para a semana de hoje: as setas também andam para trás, sem limite.
    await page.goto(`/hoje?dia=${diaDaquiA21Dias}`);
    await page.waitForLoadState("networkidle");
    for (const semanas of [2, 1, 0]) {
      await page.getByRole("button", { name: "7 dias anteriores" }).click();
      await expect(page).toHaveURL(semanas === 0 ? new RegExp(`dia=${hoje}$`) : new RegExp(`dia=${somarDias(hoje, 7 * semanas)}$`));
    }
    await expect(page).toHaveURL(new RegExp(`dia=${hoje}$`));
  });

  test("escolher 'Amanhã' em Criar grava o roteiro no dia seguinte, com o aviso de frescor na tela", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste amanha", descricao: "descricao", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    // onConflictDoNothing: este nicho é compartilhado com outro teste deste arquivo que também
    // grava temas do dia para hoje; o conteúdo exato não importa, só que exista um tema em `?tema=0`.
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas }).onConflictDoNothing();

    await entrar(page, email);

    await page.goto("/criar/objetivo?tema=0");
    await page.getByRole("radio", { name: /Que muita gente veja/ }).click();
    await page.getByRole("button", { name: "Amanhã", exact: true }).click();
    await expect(page.getByText("Ele vai ser escrito com o que está subindo hoje.")).toBeVisible();

    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    const [roteiroCriado] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(roteiroCriado.data).toBe(somarDias(hojeISO(), 1));
  });
});
