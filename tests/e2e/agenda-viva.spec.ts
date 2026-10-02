/**
 * E39b, a agenda viva (`estrategia/plano-de-execucao.md`, "E39", itens a, b, e; design v2,
 * `Hoje.dc.html`, estados `agendaComAtraso`, `agendaComAtrasoSozinho`, `agendaValeSim`,
 * `agendaValeNovo`, `calendario`): o atrasado (mudar o dia, arquivar, gravar hoje), "ainda vale?"
 * no Reels feito com antecedência, e o calendário do mês. Mesma lição de `agenda.spec.ts`: grava
 * roteiro direto no banco, só o que o teste prova de verdade passa pelo navegador.
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
  user,
  videos,
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
  formato?: "reels" | "story";
  titulo: string;
  status?: "gerado" | "gravado" | "postado";
  criadoEm?: Date;
};

async function criarRoteiro(clienteId: number, data: string, opcoes: OpcoesRoteiro) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data,
      tema: `tema de ${opcoes.titulo}`,
      origem: "sugerido",
      objetivo: "engajamento",
      formato: opcoes.formato ?? "reels",
      conteudo: { ...CONTEUDO_MINIMO, titulo: opcoes.titulo },
      status: opcoes.status ?? "gerado",
      ...(opcoes.criadoEm ? { criadoEm: opcoes.criadoEm } : {}),
    })
    .returning();
  return roteiro;
}

function somarDias(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias, 12)).toISOString().slice(0, 10);
}

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

let contador = 0;

/** `pisoViews: 0` para o setor nascer sem régua (E39b, item a): o vídeo do teste não precisa de milhões de views. */
async function criarMarca(opcoes: { pisoViews?: number } = {}) {
  contador += 1;
  const usuarioId = `e2e-agenda-viva-${contador}-${test.info().testId}`;
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: `e2e-agenda-viva-${contador}-${test.info().testId}`, nome: "[teste] Agenda viva", pisoViews: opcoes.pisoViews ?? 0 })
    .returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Agenda viva", email: `${usuarioId}@exemplo.teste` });
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
    .values({ usuarioId, nome: "[teste] Agenda viva", nichoId: nicho.id })
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
  return { usuarioId, marcaId: marca.id, nichoId: nicho.id, email: `${usuarioId}@exemplo.teste` };
}

test.describe("Atrasado (E39b, item b)", () => {
  test("sozinho (hoje livre): 'Gravar hoje' aparece primeiro, move o roteiro para hoje e some da lista", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, somarDias(hoje, -2), { titulo: "ficou para trás" });

    await entrar(page, email);

    await expect(page.getByRole("heading", { name: "Atrasado" })).toBeVisible();
    await expect(page.getByText("ficou para trás")).toBeVisible();
    await page.getByRole("button", { name: "Gravar hoje" }).click();

    await expect(page.getByRole("heading", { name: "Atrasado" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "ficou para trás" })).toBeVisible();

    const [atual] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(atual.data).toBe(hoje);
  });

  test("com outro roteiro hoje: 'Gravar hoje' não aparece, a linha explica por quê", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, somarDias(hoje, -2), { titulo: "atrasado de verdade" });
    await criarRoteiro(marcaId, hoje, { titulo: "já tem um hoje" });

    await entrar(page, email);

    await expect(page.getByText("atrasado de verdade")).toBeVisible();
    await expect(page.getByRole("button", { name: "Gravar hoje" })).toHaveCount(0);
    await expect(page.getByText("Hoje já tem roteiro marcado. Escolha outro dia para este.")).toBeVisible();
  });

  test("'Mudar o dia' abre a pergunta de data, escolhe amanhã, e o roteiro some da lista de atrasados", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, somarDias(hoje, -3), { titulo: "vai mudar de dia" });

    await entrar(page, email);

    await page.getByRole("button", { name: "Mudar o dia" }).click();
    await expect(page.getByRole("heading", { name: "Mudar o dia" })).toBeVisible();
    await page.getByRole("button", { name: "Amanhã", exact: true }).click();
    await page.getByRole("button", { name: "Salvar" }).click();

    await expect(page.getByRole("heading", { name: "Atrasado" })).toHaveCount(0);

    const [atual] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(atual.data).toBe(somarDias(hoje, 1));
  });

  // E39c, parte 1, item 1: o X no cabeçalho fecha a folha (`Folha.tsx`), igual ao véu e ao Escape.
  test("o X fecha a folha de 'Mudar o dia' sem salvar nada", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, somarDias(hoje, -3), { titulo: "nao muda de dia" });

    await entrar(page, email);

    await page.getByRole("button", { name: "Mudar o dia" }).click();
    const folha = page.getByRole("dialog", { name: "Mudar o dia" });
    await expect(folha).toBeVisible();

    await folha.getByRole("button", { name: "Fechar" }).click();
    await expect(folha).toBeHidden();
    await expect(page.getByRole("heading", { name: "Atrasado" })).toBeVisible();

    const [atual] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(atual.data).toBe(somarDias(hoje, -3));
  });

  test("'Arquivar' tira da lista de atrasados; o roteiro continua existindo, marcado", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, somarDias(hoje, -2), { titulo: "vai ser arquivado" });

    await entrar(page, email);

    await page.getByRole("button", { name: "Arquivar" }).click();
    await expect(page.getByRole("heading", { name: "Atrasado" })).toHaveCount(0);

    const [atual] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(atual.arquivadoEm).not.toBeNull();
  });
});

test.describe("Ainda vale? (E39b, item a)", () => {
  test("sem nada mais forte: 'Conferir' mostra 'continua valendo'", async ({ page }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, hoje, { formato: "reels", titulo: "feito com antecedência", criadoEm: diasAtras(3) });

    await entrar(page, email);

    await expect(page.getByText("Feito há 3 dias.")).toBeVisible();
    await page.getByRole("button", { name: "Conferir" }).click();
    await expect(page.getByText("Este roteiro continua valendo")).toBeVisible();
  });

  test("com algo mais forte subindo: 'Conferir' mostra a evidência, e 'Criar um novo sobre isso' leva ao tema livre com o assunto", async ({
    page,
  }) => {
    const { marcaId, email, nichoId } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, hoje, { formato: "reels", titulo: "feito com antecedência", criadoEm: diasAtras(3) });
    await db()
      .insert(videos)
      .values({
        plataforma: "tiktok",
        idExterno: `e2e-ainda-vale-${test.info().testId}`,
        url: "https://exemplo.invalido/ainda-vale",
        nichoId,
        views: 999_999,
        publicadoEm: diasAtras(3),
        velocidadeRelativa: "6.0",
        // `as never`: a ficha mínima de teste não precisa dos outros campos de `AnaliseVideo`
        // (mesma técnica de `tests/integracao/pesquisa.test.ts`, `criarVideo`).
        analise: { assunto: "um jeito novo de tirar mancha", pertenceAoNicho: true } as never,
      });

    await entrar(page, email);

    await page.getByRole("button", { name: "Conferir" }).click();
    await expect(page.getByText("Saiu algo hoje que pode render mais")).toBeVisible();

    await page.getByRole("button", { name: "Criar um novo sobre isso" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?tema=/);
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue("um jeito novo de tirar mancha");
  });
});

test.describe("O calendário do mês (E39b, item e; E39c, parte 2a: aba Planejar)", () => {
  test("'Ver o mês' leva à aba Planejar, na visão Mês; tocar num dia mostra a agenda dele; a aba Hoje sai do calendário", async ({
    page,
  }) => {
    const { marcaId, email } = await criarMarca();
    const hoje = hojeISO();
    await criarRoteiro(marcaId, somarDias(hoje, 5), { titulo: "planejado para daqui a 5 dias" });

    await entrar(page, email);

    await page.getByRole("button", { name: "Ver o mês" }).click();
    await expect(page).toHaveURL(/\/planejamento\?visao=mes/);

    const diaComRoteiro = somarDias(hoje, 5);
    const [ano, mes, dia] = diaComRoteiro.split("-").map(Number);
    const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
    await page.getByRole("button", { name: new RegExp(`, ${dia} de ${nomeMes}:`) }).click();
    await expect(page).toHaveURL(new RegExp(`dia=${diaComRoteiro}`));
    await expect(page.getByText("planejado para daqui a 5 dias")).toBeVisible();

    // Sem "Voltar para hoje" no planejador: sair do calendário agora é trocar de aba.
    await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Hoje" }).click();
    await expect(page).toHaveURL(/\/hoje$/);
  });

  test("mês anterior e próximo mês navegam sem sair do calendário", async ({ page }) => {
    const { email } = await criarMarca();
    await entrar(page, email);

    await page.goto("/planejamento?visao=mes");
    const tituloInicial = await page.locator("h1").first().textContent();

    await page.getByRole("button", { name: "Próximo mês" }).click();
    await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
    await expect(page.locator("h1").first()).not.toHaveText(tituloInicial ?? "");
    const tituloProximo = await page.locator("h1").first().textContent();

    await page.getByRole("button", { name: "Mês anterior" }).click();
    await expect(page.locator("h1").first()).not.toHaveText(tituloProximo ?? "");
    const tituloVoltou = await page.locator("h1").first().textContent();
    expect(tituloVoltou).toBe(tituloInicial);
  });
});
