/**
 * A pílula "Duração" e os vídeos longos nas Referências (E52, PR 4c, passo 25 do Opus): "Mais de 3 min" troca a lista dos curtos pela dos longos do ramo, com o cartão do vídeo longo (os
 * capítulos da descrição, "o capítulo que interessa" só quando a leitura da estrutura existe, "Ver o capítulo" abrindo a prévia no segundo certo); no ramo sem vídeo longo a opção fica
 * apagada com a frase calma; o vídeo de outro ramo nunca aparece. Grava marca, vídeos e leitura direto no banco (inventados: o repositório é público). Seguro para a repetição automática.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contas, membrosMarca, nichos, preferenciasUsuario, user, videos, type AnaliseVideoLonga } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const DIA_MS = 24 * 60 * 60 * 1000;
const COM_LONGOS = "e2e-ref-longos";
const SEM_LONGOS = "e2e-ref-sem-longos";
const QUEBRA = String.fromCharCode(10);

function email(usuarioId: string): string {
  return `${usuarioId}@exemplo.teste`;
}

function analise(entregaAteS: number | null): AnaliseVideoLonga {
  return {
    versaoPrompt: "1.0.0",
    origemDosCapitulos: "descricao",
    assunto: "mancha no sofá",
    abertura: { promessa: "mostra o antes e o depois da mancha", entregaAteS, tipo: "resultado" },
    capitulos: [
      { inicioS: 0, nome: "Abertura", oQueFaz: "mostra o resultado", gancho: "mas o erro vem a seguir" },
      { inicioS: 60, nome: "Primeiro erro", oQueFaz: "esfrega antes do tempo", gancho: "e o segundo é pior" },
      { inicioS: 180, nome: "O teste no canto escondido", oQueFaz: "canto escondido", gancho: "falta o último" },
      { inicioS: 300, nome: "Fechamento", oQueFaz: "resume", gancho: null },
    ],
    lacos: [],
    ondeSairia: [],
    fechamento: { oQueFaz: "pede o comentário", apontaParaProximoVideo: false },
    porQueFuncionou: "mostra o resultado antes de explicar",
  };
}

async function criarMarca(usuarioId: string, comLongos: boolean): Promise<{ nichoId: number }> {
  const [existente] = await db().select({ id: clientes.id, nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.usuarioId, usuarioId));
  if (existente) return { nichoId: existente.nichoId! };
  const [nicho] = await db().insert(nichos).values({ slug: `${usuarioId}-nicho`, nome: `[teste] ${usuarioId}`, termos: [], pisoViews: 50_000 }).returning();
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${usuarioId}`, email: email(usuarioId) });
  await db().insert(account).values({ id: `${usuarioId}-credential`, issuer: "local:credential", accountId: usuarioId, providerId: "credential", userId: usuarioId, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${usuarioId}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "produtos de limpeza",
        referencias: [],
      },
    });
  const [conta] = await db().insert(contas).values({ plataforma: "youtube", handle: `${usuarioId}-conta`, nome: "Casa Limpa Vídeos", nichoId: nicho.id, pais: "BR", idiomaPrincipal: "pt", medianaViews: 89_500, medianaOrigem: "conta" }).returning();
  let n = 0;
  const semear = async (titulo: string, opcoes: { duracaoS: number; analiseLonga?: AnaliseVideoLonga; descricao?: string; views?: number; foraDaCurva?: string; analiseCurto?: boolean }) => {
    n += 1;
    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: `${usuarioId}-v${n}`,
        url: `https://www.youtube.com/watch?v=abcDEF${usuarioId.length}${String(n).padStart(4, "0")}`,
        nichoId: nicho.id,
        contaId: conta.id,
        titulo,
        descricao: opcoes.descricao ?? null,
        views: opcoes.views ?? 200_000,
        foraDaCurva: opcoes.foraDaCurva ?? "4.600",
        duracaoS: opcoes.duracaoS,
        publicadoEm: new Date(Date.now() - 3 * DIA_MS),
        idioma: "pt",
        analiseLonga: opcoes.analiseLonga,
        capaUrl: null,
        origem: "coleta",
        analise: opcoes.analiseCurto
          ? ({ assunto: "mancha", gancho: "olha a mancha saindo", estrutura: "gancho, demonstração", fechamento: "mostra o resultado", chamadaFinal: "comenta", formato: "fala_para_camera", porQueFuncionou: "mostra o problema" } as never)
          : undefined,
      });
  };
  // um curto com análise, que a lista dos curtos mostra e a dos longos não
  await semear("curto de mancha", { duracaoS: 40, analiseCurto: true, foraDaCurva: "6.000" });
  if (comLongos) {
    await semear("os 4 erros que estragam o sofá", { duracaoS: 662, analiseLonga: analise(200), descricao: ["00:00 Abertura", "01:00 Primeiro erro", "03:00 O teste no canto escondido", "05:00 Fechamento"].join(QUEBRA), views: 412_000, foraDaCurva: "4.600" });
    await semear("limpeza do estofado sem leitura", { duracaoS: 540, views: 150_000, foraDaCurva: "2.000" });
    await semear("sofá que a abertura não entrega", { duracaoS: 480, analiseLonga: analise(null), views: 120_000, foraDaCurva: "1.800" });
  }
  return { nichoId: nicho.id };
}

async function entrar(page: Page, usuarioId: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(usuarioId));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("Referências: a pílula Duração e os vídeos longos", () => {
  test.beforeAll(async () => {
    await criarMarca(COM_LONGOS, true);
    await criarMarca(SEM_LONGOS, false);
  });

  test("'Mais de 3 min' troca a lista dos curtos pela dos longos do ramo, e voltar para 'Curtos' traz a de sempre", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, COM_LONGOS);
    await page.goto("/referencias?periodo=30&plataforma=todas");
    await expect(page.getByText("curto de mancha")).toBeVisible();
    await expect(page.locator("[data-cartao-longo]")).toHaveCount(0);

    await page.getByRole("button", { name: /^Duração/ }).click();
    const menu = page.getByRole("menu", { name: "Duração do vídeo" });
    await expect(menu.getByRole("menuitemradio", { name: /Mais de 3 min/ })).toBeEnabled();
    await menu.getByRole("menuitemradio", { name: /Mais de 3 min/ }).click();

    await expect(page).toHaveURL(/duracao=longos/);
    await expect(page.locator("[data-cartao-longo]")).toHaveCount(3);
    await expect(page.getByText("curto de mancha")).toHaveCount(0);
    await expect(page.getByText(/3 vídeos longos fora da curva nos últimos 30 dias/)).toBeVisible();
    // a ficha do filtro ligado (o desenho a esconde a partir de 1024 px, onde a pílula já diz o estado; fica no documento para o celular)
    await expect(page.getByRole("button", { name: "Tirar o filtro Mais de 3 minutos", includeHidden: true })).toHaveCount(1);

    await page.getByRole("button", { name: /^Mais de 3 min/ }).click();
    await page.getByRole("menuitemradio", { name: "Curtos" }).click();
    await expect(page).not.toHaveURL(/duracao=longos/);
    await expect(page.getByText("curto de mancha")).toBeVisible();
    await expect(page.locator("[data-cartao-longo]")).toHaveCount(0);
  });

  test("o cartão com leitura mostra os capítulos e 'o capítulo que interessa'; sem leitura, 'Ver desde o começo'", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, COM_LONGOS);
    await page.goto("/referencias?duracao=longos&periodo=30&plataforma=todas");
    const comLeitura = page.locator("[data-cartao-longo]").filter({ hasText: "os 4 erros que estragam o sofá" });
    await expect(comLeitura).toBeVisible();
    await expect(comLeitura.locator("[data-capitulos-da-descricao]")).toContainText("3:00O teste no canto escondido");
    await expect(comLeitura.locator("[data-capitulo-que-interessa]")).toContainText("3:00 a 5:00, O teste no canto escondido");
    await expect(comLeitura.locator("[data-capitulo-que-interessa]")).toContainText("O título promete: mostra o antes e o depois da mancha");
    await expect(comLeitura.getByText("11:02")).toBeVisible();
    await expect(comLeitura.getByRole("button", { name: /Ver o capítulo de referência/ })).toBeVisible();

    const semLeitura = page.locator("[data-cartao-longo]").filter({ hasText: "limpeza do estofado sem leitura" });
    await expect(semLeitura.locator("[data-capitulo-que-interessa]")).toHaveCount(0);
    await expect(semLeitura.getByRole("button", { name: /desde o começo/ })).toBeVisible();
    // a abertura que não entrega também não inventa capítulo
    const naoEntrega = page.locator("[data-cartao-longo]").filter({ hasText: "a abertura não entrega" });
    await expect(naoEntrega.locator("[data-capitulo-que-interessa]")).toHaveCount(0);
  });

  test("'Ver o capítulo' abre a prévia no segundo do capítulo, e 'Ver desde o começo' no começo", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, COM_LONGOS);
    await page.goto("/referencias?duracao=longos&periodo=30&plataforma=todas");
    await page.locator("[data-cartao-longo]").filter({ hasText: "os 4 erros que estragam o sofá" }).getByRole("button", { name: /Ver o capítulo/ }).click();
    const folha = page.getByRole("dialog");
    await expect(folha).toBeVisible();
    // a capa com o play diz de onde o trecho começa; tocar monta o player já nesse segundo
    await expect(folha.getByText(/começa em 3:00/i)).toBeVisible();
    await folha.getByRole("button", { name: /Tocar/i }).click();
    await expect(folha.locator("iframe")).toHaveAttribute("src", /start=180/);
    // o vídeo longo não mostra a medida de "views por hora" do curto
    await expect(folha.getByText(/views por hora|passou das 72 horas/)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.locator("[data-cartao-longo]").filter({ hasText: "limpeza do estofado sem leitura" }).getByRole("button", { name: /desde o começo/ }).click();
    const folha2 = page.getByRole("dialog");
    await expect(folha2).toBeVisible();
    await expect(folha2.getByText(/começa em/i)).toHaveCount(0);
    await folha2.getByRole("button", { name: /Tocar/i }).click();
    await expect(folha2.locator("iframe")).not.toHaveAttribute("src", /start=/);
  });

  test("o ramo sem vídeo longo: a opção fica apagada com a frase calma, e o endereço direto mostra a frase em vez de uma lista vazia sem explicação", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, SEM_LONGOS);
    await page.goto("/referencias?periodo=30&plataforma=todas");
    await page.getByRole("button", { name: /^Duração/ }).click();
    const menu = page.getByRole("menu", { name: "Duração do vídeo" });
    await expect(menu.getByRole("menuitemradio", { name: /Mais de 3 min/ })).toBeDisabled();
    await expect(menu.getByText("Ainda não temos vídeos longos do seu ramo para mostrar")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);

    await page.goto("/referencias?duracao=longos&periodo=30&plataforma=todas");
    const vazio = page.locator("[data-longos-vazio]");
    await expect(vazio).toContainText("Ainda não temos vídeos longos do seu ramo para mostrar");
    await vazio.getByRole("button", { name: "Ver os vídeos curtos" }).click();
    await expect(page).not.toHaveURL(/duracao=longos/);
    await expect(page.getByText("curto de mancha")).toBeVisible();
  });

  test("os filtros que valem: as views mínimas e a busca cortam a lista dos longos, e a ficha tira só o filtro tocado", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page, COM_LONGOS);
    await page.goto("/referencias?duracao=longos&periodo=30&plataforma=todas&views=100000");
    await expect(page.locator("[data-cartao-longo]")).toHaveCount(3);
    await page.goto("/referencias?duracao=longos&periodo=30&plataforma=todas&busca=erros");
    await expect(page.locator("[data-cartao-longo]")).toHaveCount(1);
    await expect(page.getByText("os 4 erros que estragam o sofá")).toBeVisible();
  });

  test("no celular, a folha 'Filtrar' tem o grupo Duração e 'Ver os vídeos' leva à lista dos longos, sem rolagem de lado", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, COM_LONGOS);
    await page.goto("/referencias?periodo=30&plataforma=todas");
    await page.getByRole("button", { name: /^Filtrar/ }).click();
    const folha = page.getByRole("dialog", { name: "Filtrar" });
    await expect(folha.getByText("Duração", { exact: true })).toBeVisible();
    await folha.getByRole("button", { name: /Mais de 3 min/ }).click();
    await folha.getByRole("button", { name: /^Ver os/ }).click();
    await expect(page).toHaveURL(/duracao=longos/);
    await expect(page.locator("[data-cartao-longo]")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
