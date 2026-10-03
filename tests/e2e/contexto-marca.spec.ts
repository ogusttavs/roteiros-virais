/**
 * E38 PR 2, "o que entendemos da sua marca": a seção "O que a IA tirou das suas redes e do seu site"
 * no briefing (confirmar, corrigir, tirar e desfazer, com tudo persistindo), o site editável na Conta,
 * e a frase própria do TikTok (e dos outros motivos) no cartão de perfis do PR 1.
 *
 * O job `entender-marca` não roda aqui (chave zerada no e2e, sem worker): cada teste grava o estado e
 * os itens direto no banco, como `perfis-analisados.spec.ts`. Nenhum dado de cliente real: sites e
 * perfis são de exemplo (`.test`), nunca de uma marca de verdade (o repositório é público).
 *
 * Seguro para a repetição automática do Playwright (F1, item 4): o usuário de cada bloco é criado uma
 * vez, e os itens (que os testes alteram) são semeados de novo no começo de cada teste.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  contextoMarca,
  contextoMarcaItens,
  membrosMarca,
  nichos,
  perfisAnalisados,
  preferenciasUsuario,
  user,
  type AvaliacaoResposta,
  type TipoMarca,
} from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const SECAO = "O que a IA tirou das suas redes e do seu site";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Cria (uma vez) uma marca com briefing completo e devolve o id; nas repetições só a encontra. */
async function marca(
  id: string,
  extra: { site?: string | null; perfis?: { instagram: string | null; tiktok: string | null; youtube: string | null }; tipo?: TipoMarca } = {},
): Promise<number> {
  const [existente] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, id));
  if (existente) return existente.id;

  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
  await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@exemplo.teste` });
  await db()
    .insert(account)
    .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId: id,
      nome: `[teste] ${id}`,
      nichoId: nicho.id,
      site: extra.site === undefined ? "https://loja-exemplo.test" : extra.site,
      perfis: extra.perfis ?? { instagram: "loja.exemplo", tiktok: null, youtube: null },
      tipo: extra.tipo ?? "negocio",
      persona: extra.tipo === "pessoa" ? "conhecido" : "negocio",
    })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });

  const respostas: Record<string, string> = {};
  const avaliacoes: Record<string, AvaliacaoResposta> = {};
  for (const perguntaId of ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]) {
    respostas[perguntaId] = `Resposta concreta para ${perguntaId}, com o numero 42 na frase.`;
    avaliacoes[perguntaId] = {
      nota: 9,
      bom: `A resposta de ${perguntaId} tem exemplo concreto.`,
      melhorar: "Poderia trazer mais um numero ou exemplo.",
      como: "Escreva como se fosse para alguem que nunca ouviu falar do seu ramo, com um caso real.",
      impacto: "Uma resposta mais concreta gera um roteiro mais parecido com voce.",
    };
  }
  await db().insert(briefings).values({ clienteId: cliente.id, respostas, avaliacoes, notaGeral: "9.00", completo: true });
  return cliente.id;
}

/** O que a última leitura deixou: o estado da marca e três itens, um de cada situação. */
async function semearLeitura(clienteId: number): Promise<{ vende: number; posta: number; rendeu: number }> {
  await db().delete(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId));
  await db().delete(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));
  await db().insert(contextoMarca).values({
    clienteId,
    ultimaLeituraOkEm: new Date("2026-09-20T12:00:00Z"),
    ultimaTentativaEm: new Date("2026-09-20T12:00:00Z"),
    fontes: [
      { tipo: "site", lida: true, quantidade: 3 },
      { tipo: "instagram", lida: true, quantidade: 8 },
    ],
  });
  const [vende] = await db()
    .insert(contextoMarcaItens)
    .values({
      clienteId,
      categoria: "vende",
      origem: "site",
      texto: "O removedor de 500 ml agora vem com bico de spray.",
      novidade: "mudou",
    })
    .returning({ id: contextoMarcaItens.id });
  const [posta] = await db()
    .insert(contextoMarcaItens)
    .values({
      clienteId,
      categoria: "posta",
      origem: "instagram",
      texto: "Posta vídeos curtos de antes e depois em tecido claro.",
      estado: "confirmado",
      textoConfirmado: "Posta vídeos curtos de antes e depois em tecido claro.",
    })
    .returning({ id: contextoMarcaItens.id });
  const [rendeu] = await db()
    .insert(contextoMarcaItens)
    .values({
      clienteId,
      categoria: "rendeu",
      origem: "instagram",
      texto: "O vídeo do teste no canto escondido rendeu bem mais que os outros.",
      novidade: "alem_do_briefing",
    })
    .returning({ id: contextoMarcaItens.id });
  return { vende: vende.id, posta: posta.id, rendeu: rendeu.id };
}

async function itemNoBanco(id: number) {
  const [item] = await db().select().from(contextoMarcaItens).where(eq(contextoMarcaItens.id, id));
  return item;
}

function itemNaTela(page: Page, texto: string) {
  return page.getByRole("region", { name: SECAO }).getByRole("listitem").filter({ hasText: texto });
}

test.describe("briefing, a seção de o que a IA tirou das redes e do site", () => {
  test("sem site e sem perfil lido: diz como destravar e leva para a Conta (o TikTok sozinho fica guardado)", async ({ page }) => {
    await marca("e2e-contexto-sem-fonte", { site: null, perfis: { instagram: null, tiktok: "perfil.tiktok", youtube: null } });
    await entrar(page, "e2e-contexto-sem-fonte@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByRole("heading", { name: SECAO })).toBeVisible();
    await expect(secao.getByText("guarde em Conta o site da sua marca")).toBeVisible();
    await expect(secao.getByRole("link", { name: "Ir para Conta" })).toHaveAttribute("href", "/conta");
    await expect(secao.getByText("O TikTok ainda não é lido por aqui; o seu @ fica guardado.")).toBeVisible();
  });

  test("com fonte e nenhuma leitura ainda: está lendo", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-lendo");
    await db().delete(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));
    await entrar(page, "e2e-contexto-lendo@exemplo.teste");
    await page.goto("/briefing");

    await expect(page.getByRole("region", { name: SECAO }).getByText("Estamos lendo o que a sua marca mostra")).toBeVisible();
  });

  test("tentou e não leu: diz por que, em palavras de gente, para cada fonte", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-nao-leu");
    await db().delete(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));
    await db().insert(contextoMarca).values({
      clienteId,
      ultimaTentativaEm: new Date("2026-09-20T12:00:00Z"),
      fontes: [
        { tipo: "site", lida: false, motivo: "bloqueado_pelo_site" },
        { tipo: "instagram", lida: false, motivo: "conta_restrita" },
      ],
    });
    await entrar(page, "e2e-contexto-nao-leu@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("Ainda não conseguimos ler.")).toBeVisible();
    await expect(secao.getByText("Site: não deixou a gente ler.")).toBeVisible();
    await expect(secao.getByText("Instagram: só dá para ler conta profissional e sem restrição de idade.")).toBeVisible();
  });

  test("os itens aparecem com a origem, a pílula de novidade e a data da leitura; só as fontes lidas entram na frase", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-itens");
    await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-itens@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("Isto não é o que você respondeu: é o que a gente leu.")).toBeVisible();
    await expect(secao.getByText(/Lido em 20 de setembro, no Instagram e no site\. A próxima leitura é em 20 de outubro\./)).toBeVisible();

    const doSite = itemNaTela(page, "bico de spray");
    await expect(doSite.getByText("Do seu site")).toBeVisible();
    await expect(doSite.getByText("novidade deste mês")).toBeVisible();
    await expect(doSite.getByRole("button", { name: "Está certo" })).toBeVisible();

    const doInstagram = itemNaTela(page, "teste no canto escondido");
    await expect(doInstagram.getByText("algo que você não tinha contado")).toBeVisible();

    const confirmado = itemNaTela(page, "antes e depois em tecido claro");
    await expect(confirmado.getByText("Confirmado")).toBeVisible();
    await expect(confirmado.getByRole("button", { name: "Está certo" })).toHaveCount(0);
  });

  test("Está certo: o item vira Confirmado, a pílula some, e continua assim depois de recarregar", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-confirmar");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-confirmar@exemplo.teste");
    await page.goto("/briefing");

    const item = itemNaTela(page, "bico de spray");
    await item.getByRole("button", { name: "Está certo" }).click();
    await expect(item.getByText("Confirmado")).toBeVisible();
    await expect(item.getByText("novidade deste mês")).toHaveCount(0);
    // O sinal de que gravou (a action terminou): o botão de corrigir volta a ficar disponível.
    await expect(item.getByRole("button", { name: "Corrigir" })).toBeEnabled();

    await page.reload();
    await expect(itemNaTela(page, "bico de spray").getByText("Confirmado")).toBeVisible();
    expect(await itemNoBanco(ids.vende)).toMatchObject({ estado: "confirmado", novidade: null, textoConfirmado: "O removedor de 500 ml agora vem com bico de spray." });
  });

  test("Corrigir: o campo abre no próprio lugar com o texto, a pessoa escreve do jeito dela, e vale no lugar da IA", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-corrigir");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-corrigir@exemplo.teste");
    await page.goto("/briefing");

    const item = itemNaTela(page, "teste no canto escondido");
    await item.getByRole("button", { name: "Corrigir" }).click();
    const campo = page.getByLabel("Corrigir o que a IA entendeu");
    await expect(campo).toHaveValue("O vídeo do teste no canto escondido rendeu bem mais que os outros.");
    // O microfone também (a regra de falar em todo campo): o botão de falar vive junto do campo.
    await expect(page.getByRole("button", { name: "Falar" })).toBeVisible();

    await campo.fill("O que mais rende é o vídeo do meu cliente contando como ficou o sofá.");
    await page.getByRole("button", { name: "Salvar" }).click();

    const corrigido = itemNaTela(page, "meu cliente contando como ficou o sofá");
    await expect(corrigido.getByText("Corrigido por você")).toBeVisible();
    await expect(corrigido.getByText("algo que você não tinha contado")).toHaveCount(0);

    await page.reload();
    await expect(itemNaTela(page, "meu cliente contando como ficou o sofá").getByText("Corrigido por você")).toBeVisible();
    expect(await itemNoBanco(ids.rendeu)).toMatchObject({
      estado: "corrigido",
      textoConfirmado: "O que mais rende é o vídeo do meu cliente contando como ficou o sofá.",
    });
  });

  test("Corrigir: texto vazio não salva, e Cancelar volta ao que estava", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-corrigir-vazio");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-corrigir-vazio@exemplo.teste");
    await page.goto("/briefing");

    const item = itemNaTela(page, "bico de spray");
    await item.getByRole("button", { name: "Corrigir" }).click();
    await page.getByLabel("Corrigir o que a IA entendeu").fill("   ");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Escreva o que está certo, ou toque em Cancelar.")).toBeVisible();

    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByLabel("Corrigir o que a IA entendeu")).toHaveCount(0);
    await expect(itemNaTela(page, "bico de spray").getByRole("button", { name: "Está certo" })).toBeVisible();
    expect(await itemNoBanco(ids.vende)).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });
  });

  test("Tirar: o item fica riscado com Desfazer; Desfazer devolve o que era; tirado e recarregado, não volta", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-tirar");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-tirar@exemplo.teste");
    await page.goto("/briefing");

    const item = itemNaTela(page, "antes e depois em tecido claro");
    await item.getByRole("button", { name: "Tirar" }).click();
    await expect(item.getByText("Tirado. Não entra nos seus roteiros.")).toBeVisible();
    const desfazer = item.getByRole("button", { name: "Desfazer" });
    await expect(desfazer).toBeEnabled();

    await desfazer.click();
    await expect(item.getByText("Confirmado")).toBeVisible();
    await expect(item.getByRole("button", { name: "Corrigir" })).toBeEnabled();
    expect(await itemNoBanco(ids.posta)).toMatchObject({ estado: "confirmado" });

    await item.getByRole("button", { name: "Tirar" }).click();
    await expect(item.getByRole("button", { name: "Desfazer" })).toBeEnabled();
    await page.reload();
    await expect(itemNaTela(page, "antes e depois em tecido claro")).toHaveCount(0);
    expect(await itemNoBanco(ids.posta)).toMatchObject({ estado: "recusado", estadoAnterior: "confirmado" });
  });

  test("leitura boa sem nenhum item claro: diz isso, sem inventar", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-nada-claro");
    await semearLeitura(clienteId);
    await db().delete(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId));
    await entrar(page, "e2e-contexto-nada-claro@exemplo.teste");
    await page.goto("/briefing");

    await expect(page.getByRole("region", { name: SECAO }).getByText("A gente leu, mas não achou nada claro")).toBeVisible();
  });

  test("o TikTok guardado ganha a frase própria, junto das fontes lidas", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-tiktok", { perfis: { instagram: "loja.exemplo", tiktok: "perfil.tiktok", youtube: null } });
    await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-tiktok@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("O TikTok ainda não é lido por aqui; o seu @ fica guardado.")).toBeVisible();
    // A linha da data lista só o que foi lido de verdade: nunca o TikTok.
    await expect(secao.getByText(/Lido em .*no Instagram e no site/)).toBeVisible();
    await expect(secao.getByText(/Lido em .*TikTok/)).toHaveCount(0);
  });

  test("marca do tipo pessoa: nada de 'negócio' nos textos da seção", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-pessoa", { tipo: "pessoa" });
    await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-pessoa@exemplo.teste");
    await page.goto("/briefing");

    const texto = await page.getByRole("region", { name: SECAO }).innerText();
    expect(texto).toContain("Do seu site");
    expect(texto.toLowerCase()).not.toContain("negócio");
    expect(texto.toLowerCase()).not.toContain("diferencial");
  });

  test("uma marca nunca vê o que foi lido de outra", async ({ page }) => {
    const a = await marca("e2e-contexto-isolamento-a");
    await marca("e2e-contexto-isolamento-b");
    await semearLeitura(a);
    await entrar(page, "e2e-contexto-isolamento-b@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao).toBeVisible();
    await expect(secao.getByText("bico de spray")).toHaveCount(0);
    await expect(page.getByText("bico de spray")).toHaveCount(0);
  });
});

test.describe("celular: a seção cabe e os alvos de toque têm 44 pontos", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sem rolagem para o lado e nenhum botão da seção menor que 44 pontos, nem em edição", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-celular");
    await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-celular@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao).toBeVisible();
    await itemNaTela(page, "teste no canto escondido").getByRole("button", { name: "Corrigir" }).click();
    await expect(page.getByLabel("Corrigir o que a IA entendeu")).toBeVisible();

    const medidas = await secao.evaluate((no) => ({
      rolagemParaOLado: document.documentElement.scrollWidth > window.innerWidth,
      pequenos: Array.from(no.querySelectorAll("button, a, textarea"))
        .map((el) => ({ nome: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), altura: el.getBoundingClientRect().height }))
        .filter((m) => m.altura > 0 && m.altura < 44),
      campoComFonteMenor: Array.from(no.querySelectorAll("textarea")).filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).length,
    }));
    expect(medidas.rolagemParaOLado).toBe(false);
    expect(medidas.pequenos).toEqual([]);
    expect(medidas.campoComFonteMenor).toBe(0);
  });
});

test.describe("o cartão de perfis do PR 1: cada motivo com a frase certa", () => {
  test("TikTok desligado, conta restrita e sem vídeo não pedem para conferir o @; só 'não encontrado' pede", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-motivos");
    await db().delete(perfisAnalisados).where(eq(perfisAnalisados.clienteId, clienteId));
    await db().insert(perfisAnalisados).values([
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "tiktok", handle: "perfil.tiktok", existeNaRede: false, motivo: "tiktok_desligado" },
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "instagram", handle: "perfil.pessoal", existeNaRede: false, motivo: "conta_restrita" },
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "youtube", handle: "@canalsemvideo", existeNaRede: false, motivo: "sem_videos" },
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "instagram", handle: "perfil.errado", existeNaRede: false, motivo: "nao_encontrado" },
      // Linha gravada antes da coluna (motivo nulo): TikTok continua sendo "desligado", o resto "não encontrado".
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "tiktok", handle: "perfil.antigo", existeNaRede: false, motivo: null },
    ]);
    await entrar(page, "e2e-contexto-motivos@exemplo.teste");
    await page.goto("/briefing");

    const cartao = page.getByRole("region", { name: "O que a IA viu nos perfis" });
    // Duas linhas de TikTok: a que gravou o motivo e a antiga, sem motivo.
    await expect(cartao.getByText("O TikTok ainda não é lido por aqui; o seu @ fica guardado.")).toHaveCount(2);
    await expect(
      cartao.getByText("Não conseguimos ler este perfil: o Instagram só deixa quando a conta é profissional e sem restrição de idade."),
    ).toBeVisible();
    await expect(cartao.getByText("Este perfil ainda não tem vídeo publicado para a gente ler.")).toBeVisible();
    // Só o @ de verdade errado pede para conferir; e o YouTube (que já vem com "@") nunca mostra "@@".
    await expect(cartao.getByText("Não achamos este perfil na rede. Confira se o @ está certo.")).toHaveCount(1);
    await expect(cartao.getByText("@canalsemvideo", { exact: true })).toBeVisible();
    await expect(cartao.getByText("@@canalsemvideo")).toHaveCount(0);
  });
});

test.describe("Conta: o site da marca se edita no mesmo lugar dos perfis", () => {
  test("grava o site, mostra o que foi salvo, e recusa um endereço que não parece site", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-conta", { site: null, perfis: { instagram: null, tiktok: null, youtube: null } });
    await db().update(clientes).set({ site: null }).where(eq(clientes.id, clienteId));
    await entrar(page, "e2e-contexto-conta@exemplo.teste");
    await page.goto("/conta");

    const campo = page.getByLabel("O site da sua marca, se tiver");
    await expect(campo).toBeVisible();
    await expect(campo).toHaveValue("");

    await campo.fill("isso nao e um site");
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("esse endereço não parece um site válido")).toBeVisible();
    expect((await db().select({ site: clientes.site }).from(clientes).where(eq(clientes.id, clienteId)))[0].site).toBeNull();

    await campo.fill("https://loja-exemplo.test");
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("O site da sua marca, se tiver")).toHaveValue("https://loja-exemplo.test");
    expect((await db().select({ site: clientes.site }).from(clientes).where(eq(clientes.id, clienteId)))[0].site).toBe("https://loja-exemplo.test");
  });
});
