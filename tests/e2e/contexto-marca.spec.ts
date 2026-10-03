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
import { config } from "../../src/lib/config";
import { textosBriefing } from "../../src/textos/briefing";

const SENHA = "ExemploSenha123";
const SECAO = "O que a IA tirou das suas redes e do seu site";

/**
 * As datas da leitura são relativas a HOJE (meio-dia UTC, 10 dias atrás): com data fixa, a "próxima leitura" já teria passado e a tela,
 * que nunca anuncia uma data que passou, deixaria o teste vermelho sozinho (a partir de 20/10/2026). A frase esperada vem do mesmo texto
 * que a tela usa (o texto em si tem teste de unidade com datas fixas, `src/textos/briefing-contexto.test.ts`).
 */
const LEITURA_EM = (() => {
  const data = new Date();
  data.setUTCHours(12, 0, 0, 0);
  return new Date(data.getTime() - 10 * 86_400_000);
})();
const PROXIMA_EM = new Date(LEITURA_EM.getTime() + config.regras.diasEntreLeituraMarca * 86_400_000);
const FRASE_DA_DATA = textosBriefing.contextoDaMarca.lidoEm(LEITURA_EM, ["instagram", "site"], PROXIMA_EM);

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
    ultimaLeituraOkEm: LEITURA_EM,
    ultimaTentativaEm: LEITURA_EM,
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
      ultimaTentativaEm: LEITURA_EM,
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
    await expect(
      secao.getByText("Instagram: não conseguimos ler este perfil. Confira o @; o Instagram também só deixa ler conta profissional e sem restrição de idade."),
    ).toBeVisible();
  });

  test("os itens aparecem com a origem, a pílula de novidade e a data da leitura; só as fontes lidas entram na frase", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-itens");
    await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-itens@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("Isto não é o que você respondeu: é o que a gente leu.")).toBeVisible();
    await expect(secao.getByText(FRASE_DA_DATA, { exact: true })).toBeVisible();

    const doSite = itemNaTela(page, "bico de spray");
    await expect(doSite.getByText("Do seu site")).toBeVisible();
    await expect(doSite.getByText("mudou desde a última leitura")).toBeVisible();
    await expect(doSite.getByRole("button", { name: "Está certo" })).toBeVisible();

    const doInstagram = itemNaTela(page, "teste no canto escondido");
    await expect(doInstagram.getByText("algo que você não tinha contado")).toBeVisible();

    const confirmado = itemNaTela(page, "antes e depois em tecido claro");
    await expect(confirmado.getByText("Confirmado")).toBeVisible();
    await expect(confirmado.getByRole("button", { name: "Está certo" })).toHaveCount(0);
    // A pílula de "novidade deste mês" é só dos itens novos (aqui, nenhum).
    await expect(secao.getByText("novidade deste mês", { exact: true })).toHaveCount(0);
  });

  test("Está certo: o item vira Confirmado, a pílula some, e continua assim depois de recarregar", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-confirmar");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-confirmar@exemplo.teste");
    await page.goto("/briefing");

    const item = itemNaTela(page, "bico de spray");
    await item.getByRole("button", { name: "Está certo" }).click();
    await expect(item.getByText("Confirmado")).toBeVisible();
    await expect(item.getByText("mudou desde a última leitura")).toHaveCount(0);
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
    const linhaDaData = secao.getByText(/^Lido em /);
    await expect(linhaDaData).toHaveText(FRASE_DA_DATA);
    await expect(linhaDaData).not.toContainText("TikTok");
  });

  test("os textos da seção não falam em 'negócio' (servem à pessoa e ao negócio: o cartão é o mesmo para os dois tipos)", async ({ page }) => {
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

  test("a ação falha (rede cortada): a linha volta ao que era, com a frase embaixo dela, e nada é gravado", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-falha");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-falha@exemplo.teste");
    await page.goto("/briefing");
    // As ações do servidor são POST para a própria página: corta todas.
    await page.route("**/briefing", (rota) => (rota.request().method() === "POST" ? rota.abort("failed") : rota.continue()));

    const item = itemNaTela(page, "bico de spray");
    await item.getByRole("button", { name: "Está certo" }).click();

    await expect(item.getByRole("alert")).toContainText(/Não conseguimos confirmar agora|Sem conexão/);
    await expect(item.getByRole("button", { name: "Está certo" })).toBeVisible();
    await expect(item.getByText("Confirmado")).toHaveCount(0);
    expect(await itemNoBanco(ids.vende)).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });

    // Tirar também volta, e a correção continua no campo (nada que a pessoa escreveu se perde).
    await item.getByRole("button", { name: "Tirar" }).click();
    await expect(item.getByRole("alert")).toContainText(/Não conseguimos tirar agora|Sem conexão/);
    await item.getByRole("button", { name: "Corrigir" }).click();
    await page.getByLabel("Corrigir o que a IA entendeu").fill("Texto que a pessoa escreveu.");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Não conseguimos guardar a correção agora|Sem conexão/ })).toBeVisible();
    await expect(page.getByLabel("Corrigir o que a IA entendeu")).toHaveValue("Texto que a pessoa escreveu.");
    expect(await itemNoBanco(ids.vende)).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });
  });

  test("a leitura trocou o texto enquanto a página estava aberta: 'Está certo' não confirma o que a pessoa não leu, e a seção mostra o texto novo", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-mudou");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-mudou@exemplo.teste");
    await page.goto("/briefing");
    await expect(itemNaTela(page, "bico de spray")).toBeVisible();

    // O que a leitura mensal faz: troca a proposta do item que a pessoa ainda não decidiu.
    await db().update(contextoMarcaItens).set({ texto: "Agora o removedor vem em refil de 1 litro." }).where(eq(contextoMarcaItens.id, ids.vende));
    await itemNaTela(page, "bico de spray").getByRole("button", { name: "Está certo" }).click();

    await expect(page.getByText("Esta leitura mudou enquanto você olhava. Confira o texto novo e confirme de novo.")).toBeVisible();
    await expect(itemNaTela(page, "refil de 1 litro")).toBeVisible();
    await expect(itemNaTela(page, "bico de spray")).toHaveCount(0);
    expect(await itemNoBanco(ids.vende)).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });

    // Com o texto novo diante dos olhos, confirmar vale.
    await itemNaTela(page, "refil de 1 litro").getByRole("button", { name: "Está certo" }).click();
    await expect(itemNaTela(page, "refil de 1 litro").getByText("Confirmado")).toBeVisible();
    await expect.poll(async () => (await itemNoBanco(ids.vende)).textoConfirmado).toBe("Agora o removedor vem em refil de 1 litro.");
  });

  test("uma proposta nova por cima de um texto já confirmado mostra o que continua valendo nos roteiros", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-valia-antes");
    const ids = await semearLeitura(clienteId);
    await db()
      .update(contextoMarcaItens)
      .set({ estado: "para_confirmar", texto: "Agora também vende amaciante.", textoConfirmado: "Vende só removedor de manchas.", novidade: "mudou" })
      .where(eq(contextoMarcaItens.id, ids.vende));
    await entrar(page, "e2e-contexto-valia-antes@exemplo.teste");
    await page.goto("/briefing");

    const item = itemNaTela(page, "Agora também vende amaciante.");
    await expect(item.getByText("mudou desde a última leitura")).toBeVisible();
    await expect(item.getByText("Até você decidir, nos seus roteiros continua valendo o que você tinha confirmado:")).toBeVisible();
    await expect(item.getByText("Vende só removedor de manchas.")).toBeVisible();
  });

  test("o que a pessoa tirou fica numa lista à parte, e dá para desfazer depois de recarregar", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-tirados");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-tirados@exemplo.teste");
    await page.goto("/briefing");

    await itemNaTela(page, "antes e depois em tecido claro").getByRole("button", { name: "Tirar" }).click();
    await expect(itemNaTela(page, "antes e depois em tecido claro").getByRole("button", { name: "Desfazer" })).toBeEnabled();
    await page.reload();

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("1 item que você tirou")).toBeVisible();
    await secao.getByText("1 item que você tirou").click();
    await expect(secao.getByText("O que você tira não volta sozinho.")).toBeVisible();
    await secao.getByRole("button", { name: /^Desfazer/ }).click();

    await expect(itemNaTela(page, "antes e depois em tecido claro").getByText("Confirmado")).toBeVisible();
    await expect(secao.getByText("1 item que você tirou")).toHaveCount(0);
    expect(await itemNoBanco(ids.posta)).toMatchObject({ estado: "confirmado" });
  });

  test("a pessoa tirou todos os itens: a seção diz que não sobrou nada para confirmar (e não que a leitura não achou nada)", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-tudo-tirado");
    await semearLeitura(clienteId);
    await db().update(contextoMarcaItens).set({ estado: "recusado", estadoAnterior: "para_confirmar" }).where(eq(contextoMarcaItens.clienteId, clienteId));
    await entrar(page, "e2e-contexto-tudo-tirado@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("Não sobrou nada para confirmar.")).toBeVisible();
    await expect(secao.getByText("A gente leu, mas não achou nada claro")).toHaveCount(0);
    await expect(secao.getByText("3 itens que você tirou")).toBeVisible();
  });

  test("o que a pessoa já confirmou continua à vista mesmo sem nenhuma fonte na Conta (ainda alimenta os roteiros)", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-confirmado-sem-fonte", { site: null, perfis: { instagram: null, tiktok: null, youtube: null } });
    await semearLeitura(clienteId);
    await db().update(clientes).set({ site: null, perfis: { instagram: null, tiktok: null, youtube: null } }).where(eq(clientes.id, clienteId));
    await db().update(contextoMarcaItens).set({ sumiuEm: new Date("2026-09-25T12:00:00Z") }).where(eq(contextoMarcaItens.clienteId, clienteId));
    await entrar(page, "e2e-contexto-confirmado-sem-fonte@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao.getByText("guarde em Conta o site da sua marca")).toBeVisible();
    // O confirmado aparece (e pode ser tirado); o que ninguém confirmou e a fonte deixou de dizer, não.
    await expect(itemNaTela(page, "antes e depois em tecido claro").getByText("Confirmado")).toBeVisible();
    await expect(itemNaTela(page, "antes e depois em tecido claro").getByRole("button", { name: "Tirar" })).toBeVisible();
    await expect(secao.getByText("bico de spray")).toHaveCount(0);
  });

  test("teclado e leitor de tela: o campo de correção recebe o foco, o foco volta ao botão, os botões dizem de qual item são, e o resultado é anunciado", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-acessivel");
    await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-acessivel@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    // O nome do botão leva o começo do texto do item: com vários itens, "Está certo" sozinho não diz qual.
    const confirmar = secao.getByRole("button", { name: "Está certo: O removedor de 500 ml agora vem com bico de spray." });
    await expect(confirmar).toBeVisible();

    const corrigir = secao.getByRole("button", { name: "Corrigir: O removedor de 500 ml agora vem com bico de spray." });
    await corrigir.focus();
    await page.keyboard.press("Enter");
    const campo = page.getByLabel("Corrigir o que a IA entendeu");
    await expect(campo).toBeFocused();

    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(corrigir).toBeFocused();

    await confirmar.click();
    await expect(secao.getByRole("status").filter({ hasText: "Item confirmado." })).toBeAttached();
    await expect(corrigir).toBeFocused();
  });

  test("o campo de correção mostra o contador, e texto acima do limite é recusado com a frase certa (nunca cortado em silêncio)", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-limite");
    const ids = await semearLeitura(clienteId);
    await entrar(page, "e2e-contexto-limite@exemplo.teste");
    await page.goto("/briefing");

    await itemNaTela(page, "bico de spray").getByRole("button", { name: "Corrigir" }).click();
    const campo = page.getByLabel("Corrigir o que a IA entendeu");
    await campo.fill("a".repeat(600));
    await expect(page.getByText("600 de 500 caracteres")).toBeVisible();
    await page.getByRole("button", { name: "Salvar" }).click();

    await expect(page.getByText("Passou de 500 caracteres.")).toBeVisible();
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    await expect(campo).toHaveValue("a".repeat(600));
    expect(await itemNoBanco(ids.vende)).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });
  });
});

test.describe("celular: a seção cabe e os alvos de toque têm 44 pontos", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sem rolagem para o lado e nenhum botão da seção menor que 44 pontos, nem em edição", async ({ page }) => {
    const clienteId = await marca("e2e-contexto-celular");
    await semearLeitura(clienteId);
    // Um texto sem espaço onde quebrar (um link, uma cadeia de hashtags), como o que vem de uma página de terceiros: não pode alargar a página.
    await db().insert(contextoMarcaItens).values({
      clienteId,
      categoria: "fala",
      origem: "site",
      texto: `Usa sempre as mesmas hashtags: ${"#removedor".repeat(14)} e o endereco ${"a".repeat(90)}`,
    });
    await entrar(page, "e2e-contexto-celular@exemplo.teste");
    await page.goto("/briefing");

    const secao = page.getByRole("region", { name: SECAO });
    await expect(secao).toBeVisible();
    await itemNaTela(page, "teste no canto escondido").getByRole("button", { name: "Corrigir" }).click();
    await expect(page.getByLabel("Corrigir o que a IA entendeu")).toBeVisible();

    const medir = () =>
      secao.evaluate((no) => ({
        rolagemParaOLado: document.documentElement.scrollWidth > window.innerWidth,
        // Altura E largura: um botão de 30 pontos de largura também erra o toque.
        pequenos: Array.from(no.querySelectorAll("button, a, textarea, summary"))
          .map((el) => {
            const caixa = el.getBoundingClientRect();
            return { nome: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), altura: caixa.height, largura: caixa.width };
          })
          .filter((m) => m.altura > 0 && (m.altura < 44 || m.largura < 44)),
        campoComFonteMenor: Array.from(no.querySelectorAll("textarea")).filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).length,
      }));

    const emEdicao = await medir();
    expect(emEdicao.rolagemParaOLado).toBe(false);
    expect(emEdicao.pequenos).toEqual([]);
    expect(emEdicao.campoComFonteMenor).toBe(0);

    // O estado "tirado" (com Desfazer) e a lista dos tirados, depois de recarregar.
    await page.getByRole("button", { name: "Cancelar" }).click();
    await itemNaTela(page, "antes e depois em tecido claro").getByRole("button", { name: "Tirar" }).click();
    await expect(itemNaTela(page, "antes e depois em tecido claro").getByRole("button", { name: "Desfazer" })).toBeEnabled();
    const tirado = await medir();
    expect(tirado.rolagemParaOLado).toBe(false);
    expect(tirado.pequenos).toEqual([]);

    await page.reload();
    await secao.getByText("1 item que você tirou").click();
    const listaDosTirados = await medir();
    expect(listaDosTirados.rolagemParaOLado).toBe(false);
    expect(listaDosTirados.pequenos).toEqual([]);
  });

  test("sem fonte: o link 'Ir para Conta' também cabe e tem 44 pontos", async ({ page }) => {
    await marca("e2e-contexto-celular-sem-fonte", { site: null, perfis: { instagram: null, tiktok: null, youtube: null } });
    await entrar(page, "e2e-contexto-celular-sem-fonte@exemplo.teste");
    await page.goto("/briefing");

    const link = page.getByRole("region", { name: SECAO }).getByRole("link", { name: "Ir para Conta" });
    await expect(link).toBeVisible();
    const caixa = await link.boundingBox();
    expect(caixa!.height).toBeGreaterThanOrEqual(44);
    expect(caixa!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
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
      // Linhas gravadas pelo PR 1, antes da coluna (motivo nulo): cada frase velha ainda diz o motivo certo.
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "tiktok", handle: "perfil.antigo", existeNaRede: false, motivo: null },
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "instagram", handle: "perfil.pessoal.antigo", existeNaRede: false, motivo: null, erro: "perfil pessoal ou com restricao de idade." },
      { clienteId, perfilCitadoId: null, origem: "citado", rede: "youtube", handle: "@canalantigo", existeNaRede: false, motivo: null, erro: "o canal nao tem video publicado." },
    ]);
    await entrar(page, "e2e-contexto-motivos@exemplo.teste");
    await page.goto("/briefing");

    const cartao = page.getByRole("region", { name: "O que a IA viu nos perfis" });
    // Duas linhas de TikTok: a que gravou o motivo e a antiga, sem motivo. A frase é neutra ("este @"): serve ao concorrente citado.
    await expect(cartao.getByText("O TikTok ainda não é lido por aqui; este @ fica guardado.")).toHaveCount(2);
    // Duas de conta restrita: a que gravou o motivo e a antiga do PR 1 (motivo nulo, só a frase no erro), que não vira "confira o @ de uma conta que existe".
    await expect(
      cartao.getByText("Não conseguimos ler este perfil. Confira o @; o Instagram também só deixa ler conta profissional e sem restrição de idade."),
    ).toHaveCount(2);
    await expect(cartao.getByText("Este perfil ainda não tem vídeo publicado para a gente ler.")).toHaveCount(2);
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
    // O erro mora no próprio campo (liga a ele por aria-describedby), e o foco vai para lá.
    await expect(page.getByText("Esse endereço não parece um site válido. Confira se está escrito certo.")).toBeVisible();
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    await expect(campo).toBeFocused();
    expect((await db().select({ site: clientes.site }).from(clientes).where(eq(clientes.id, clienteId)))[0].site).toBeNull();

    // Quase todo mundo digita sem o https://: é aceito e guardado com ele.
    await campo.fill("loja-exemplo.test");
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo", { exact: true })).toBeVisible();
    await expect(campo).toHaveValue("https://loja-exemplo.test");
    expect((await db().select({ site: clientes.site }).from(clientes).where(eq(clientes.id, clienteId)))[0].site).toBe("https://loja-exemplo.test");

    await campo.fill("https://loja-exemplo.test");
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("O site da sua marca, se tiver")).toHaveValue("https://loja-exemplo.test");
    expect((await db().select({ site: clientes.site }).from(clientes).where(eq(clientes.id, clienteId)))[0].site).toBe("https://loja-exemplo.test");
  });
});
