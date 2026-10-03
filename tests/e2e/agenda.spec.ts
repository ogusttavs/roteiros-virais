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

/** Segunda a domingo da semana que contém `dataISO`, sem depender do fuso do servidor (mesma conta de `semanaDaAgenda`). */
function segundaDaSemana(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 12));
  const diaDaSemana = data.getUTCDay();
  const voltarAteSegunda = diaDaSemana === 0 ? 6 : diaDaSemana - 1;
  data.setUTCDate(data.getUTCDate() - voltarAteSegunda);
  return data.toISOString().slice(0, 10);
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
    const semana = segundaDaSemana(hoje);
    // `/criar` recusa data passada (decisão 5: `data >= hoje`); precisa ser um dia futuro dentro
    // da semana visível em /hoje (fora da semana atual cai em hoje, calendário é a E39b, fora do
    // escopo). Sábado ou domingo podem não sobrar dia válido; se não sobrar, o teste falha claro.
    const outroDia = Array.from({ length: 7 }, (_, indice) => somarDias(semana, indice)).find(
      (data) => data !== hoje && data !== amanha && data > hoje,
    );
    // Sábado e domingo não deixam dia válido na semana visível (achado da revisão do PR #108, rodada num
    // sábado): o teste pula com motivo em vez de falhar por causa do calendário.
    test.skip(!outroDia, "sem dia futuro na semana visível (sábado ou domingo); o cenário vale de segunda a sexta");
    const dia = outroDia as string;
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

    await page.getByRole("radio", { name: "Mais gente me conhecer" }).click();

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
    const semana = segundaDaSemana(hoje);
    const outroDia = Array.from({ length: 7 }, (_, indice) => somarDias(semana, indice)).find((data) => data !== hoje)!;
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
      await page.getByRole("button", { name: "Próxima semana" }).click();
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
      await page.getByRole("button", { name: "Semana anterior" }).click();
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
    await page.getByRole("radio", { name: "Mais gente me conhecer" }).click();
    await page.getByRole("button", { name: "Amanhã", exact: true }).click();
    await expect(page.getByText("Ele vai ser escrito com o que está subindo hoje.")).toBeVisible();

    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    const [roteiroCriado] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(roteiroCriado.data).toBe(somarDias(hojeISO(), 1));
  });
});
