/**
 * `/noticias`, as Notícias como blog do dia (E53, passo 20; design v2, `entrega/telas/Noticias.dc.html`): a capa com o destaque e os cartões, a foto do veículo com o crédito e sem `referer`,
 * o título que abre o original numa aba (e só se o endereço for https), as pílulas de origem, a folha dos assuntos (acrescentar, repetido, manter, tirar), abrir uma notícia de assunto
 * mantendo o assunto vivo, "Criar roteiro com esta notícia" até um roteiro gerado e "virou roteiro" isolado por marca. Grava notícia, assunto, briefing e foto direto no banco; só a avaliação do
 * tema e a geração do roteiro passam pelo navegador, contra o `AI_PROVIDER=mock` do servidor. Seguro para a repetição automática do Playwright: cada teste põe os assuntos da marca no estado de partida.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, assuntosDaMarca, briefings, clientes, membrosMarca, nichos, noticias, noticiasDoAssunto, preferenciasUsuario, roteiros, user } from "../../src/db/schema";
import { inicioDoDiaEmSaoPaulo } from "../../src/servicos/noticias-do-dia";
import { textosNav } from "../../src/textos/nav";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-noticias@exemplo.teste";
const NOME_MARCA_UM = "[teste] Notícias Um";
const NOME_MARCA_DOIS = "[teste] Notícias Dois";
const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";

const TITULO_SETOR_HOJE = "[teste] venda de produto multiuso cresce no trimestre";
const TITULO_SETOR_ONTEM = "[teste] notícia de ontem, só aparece embaixo";
const TITULO_ANTIGO = "[teste] notícia de três semanas atrás, nunca aparece";
const TITULO_SETOR_FOTO = "[teste] setor com foto do portal, vinda do RSS direto";
const TITULO_ASSUNTO_FOTO = "[teste] debate esquenta a eleição e divide os candidatos";
const TITULO_ASSUNTO_INSEGURO = "[teste] eleição: notícia com endereço que não é seguro";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Mesmo padrão de `garantirMarcaDoisAtiva` em `referencias.spec.ts`: troca só se precisar. */
async function garantirMarcaDoisAtiva(page: Page) {
  await page.goto("/hoje");
  const pilulaDois = page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) });
  const pilulaUm = page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) });
  await expect(pilulaDois.or(pilulaUm)).toBeVisible();
  if (!(await pilulaDois.isVisible())) {
    await pilulaUm.click();
    const folhaMarcas = page.getByRole("dialog", { name: textosNav.suasMarcas });
    await folhaMarcas.getByRole("button", { name: NOME_MARCA_DOIS }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
}

function briefingCompletoExemplo() {
  return {
    completo: true as const,
    perfil: {
      fatos: {
        oQueVende: "kit tira-mancha para estofados",
        preco: "kit a partir de 89 reais",
        clienteIdeal: "mora em apartamento",
        medos: [],
        frasesDaFala: [],
        proibicoes: [],
        cenasFilmaveis: [],
        concorrentes: [],
        perfisAdmirados: [],
      },
      resumo: "marca propria de produtos de limpeza",
      referencias: [],
    },
  };
}

let marcaUmId = 0;
let nichoId = 0;

/** Um instante de hoje (no fuso de São Paulo): trinta minutos atrás, mas nunca antes da meia-noite, para o teste não depender da hora em que roda. */
function hoje(): Date {
  return new Date(Math.max(Date.now() - 30 * 60 * 1000, inicioDoDiaEmSaoPaulo(new Date()).getTime() + 60 * 1000));
}

/** O estado de partida de cada teste: um assunto "política" com duas notícias (uma com foto https, uma com foto e link que não são seguros) e outro parado há 25 dias. */
async function prepararAssuntos(): Promise<{ politicaId: number; paradoId: number }> {
  await db().delete(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marcaUmId));
  const [politica] = await db().insert(assuntosDaMarca).values({ clienteId: marcaUmId, texto: "política", termos: ["eleição", "Câmara"] }).returning();
  const vinteECinco = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
  const [parado] = await db().insert(assuntosDaMarca).values({ clienteId: marcaUmId, texto: "esporte", termos: ["copa"], criadoEm: vinteECinco, ultimoAbertoEm: vinteECinco }).returning();
  await db()
    .insert(noticiasDoAssunto)
    .values([
      {
        assuntoId: politica.id,
        titulo: TITULO_ASSUNTO_FOTO,
        veiculo: "[teste] Diário Exemplo",
        url: "https://exemplo.invalido/e2e-noticias-eleicao",
        publicadoEm: hoje(),
        imagemUrl: "https://exemplo.invalido/e2e-noticias-foto.jpg",
        imagemCredito: "Foto: [teste] Diário Exemplo",
        resumoNosso: "Os candidatos se enfrentaram em um debate com troca de acusações.",
        origem: "rss",
      },
      {
        assuntoId: politica.id,
        titulo: TITULO_ASSUNTO_INSEGURO,
        veiculo: "[teste] Rádio Exemplo",
        url: "javascript:alert(1)",
        publicadoEm: new Date(hoje().getTime() - 60_000),
        imagemUrl: "http://exemplo.invalido/foto-sem-https.jpg",
        imagemCredito: "Foto: [teste] Rádio Exemplo",
        resumoNosso: "Esta notícia veio com um endereço que não é seguro.",
        origem: "rss",
      },
    ]);
  return { politicaId: politica.id, paradoId: parado.id };
}

test.describe("/noticias", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-noticias"));
    if (!jaExiste) {
      const [nicho] = await db().insert(nichos).values({ slug: "e2e-noticias", nome: "[teste] Notícias" }).returning();

      await db().insert(user).values({ id: "e2e-noticias", name: "[teste] Notícias", email: EMAIL });
      await db()
        .insert(account)
        .values({
          id: "e2e-noticias-credential",
          issuer: "local:credential",
          accountId: "e2e-noticias",
          providerId: "credential",
          userId: "e2e-noticias",
          password: await hashPassword(SENHA),
        });
      await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-noticias", aceitouTermosEm: new Date() });

      // Dois primeiro, Um depois: a marca ativa no primeiro login (sem cookie ainda) é a de criação mais recente. A Dois leva um criadoEm de um minuto atrás: duas marcas
      // criadas em seguida podem empatar no milissegundo, e o empate cai na ordem do nome (a Dois abriria primeiro).
      const [marcaDois] = await db()
        .insert(clientes)
        .values({ usuarioId: "e2e-noticias", nome: NOME_MARCA_DOIS, nichoId: nicho.id, criadoEm: new Date(Date.now() - 60_000) })
        .returning();
      const [marcaUm] = await db().insert(clientes).values({ usuarioId: "e2e-noticias", nome: NOME_MARCA_UM, nichoId: nicho.id }).returning();
      await db()
        .insert(membrosMarca)
        .values([
          { usuarioId: "e2e-noticias", clienteId: marcaUm.id, papel: "dono" },
          { usuarioId: "e2e-noticias", clienteId: marcaDois.id, papel: "dono" },
        ]);
      await db()
        .insert(briefings)
        .values([
          { clienteId: marcaUm.id, ...briefingCompletoExemplo() },
          { clienteId: marcaDois.id, ...briefingCompletoExemplo() },
        ]);

      const agora = Date.now();
      await db()
        .insert(noticias)
        .values([
          {
            nichoId: nicho.id,
            titulo: TITULO_SETOR_HOJE,
            url: "https://exemplo.invalido/e2e-noticias-setor-hoje",
            fonte: "[teste] Jornal Exemplo",
            publicadoEm: hoje(),
            resumo: "Associação do setor registrou alta nas vendas de produtos multiuso no trimestre.",
            relevante: true,
            angulo: "Mostre a sua rotina usando o produto e explique o que faz ele render mais.",
          },
          {
            // E53 (foto do setor): a notícia do setor com a foto que o RSS direto do portal trouxe, e o crédito.
            nichoId: nicho.id,
            titulo: TITULO_SETOR_FOTO,
            url: "https://exemplo.invalido/e2e-noticias-setor-foto",
            fonte: "[teste] Jornal Exemplo",
            publicadoEm: new Date(hoje().getTime() - 2 * 60 * 60 * 1000),
            resumo: "Uma notícia do setor com a foto do veículo.",
            relevante: true,
            angulo: null,
            imagemUrl: "https://exemplo.invalido/e2e-noticias-setor-foto.jpg",
            imagemCredito: "Foto: [teste] Jornal Exemplo",
          },
          {
            nichoId: nicho.id,
            titulo: TITULO_SETOR_ONTEM,
            url: "https://exemplo.invalido/e2e-noticias-setor-ontem",
            fonte: "[teste] Jornal Exemplo",
            publicadoEm: new Date(inicioDoDiaEmSaoPaulo(new Date()).getTime() - 3 * 60 * 60 * 1000),
            resumo: null,
            relevante: true,
            angulo: null,
          },
          {
            nichoId: nicho.id,
            titulo: TITULO_ANTIGO,
            url: "https://exemplo.invalido/e2e-noticias-antiga",
            fonte: null,
            publicadoEm: new Date(agora - 20 * 24 * 60 * 60 * 1000),
            resumo: "Notícia de três semanas atrás.",
            relevante: true,
            angulo: null,
          },
          {
            nichoId: nicho.id,
            titulo: "[teste] notícia não relevante, nunca aparece",
            url: "https://exemplo.invalido/e2e-noticias-nao-relevante",
            fonte: "[teste] Jornal Exemplo",
            publicadoEm: hoje(),
            resumo: null,
            relevante: false,
            angulo: null,
          },
        ]);
    }
    const [marcaUm] = await db().select().from(clientes).where(eq(clientes.nome, NOME_MARCA_UM));
    marcaUmId = marcaUm.id;
    nichoId = marcaUm.nichoId!;
    // Se a repetição automática rodou o cadastro antes, a notícia de hoje precisa continuar sendo "de hoje".
    await db().update(noticias).set({ publicadoEm: hoje() }).where(and(eq(noticias.nichoId, nichoId), eq(noticias.titulo, TITULO_SETOR_HOJE)));
  });

  test.beforeEach(async () => {
    await prepararAssuntos();
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("a capa do dia: destaque com a foto e o crédito, a etiqueta de onde veio, as de ontem embaixo, nunca a antiga nem a não relevante", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    await expect(page.getByRole("heading", { name: "Notícias do dia" })).toBeVisible();
    await expect(page.getByText(/notícias novas desde ontem, do seu setor e dos assuntos que você acompanha/)).toBeVisible();

    // O destaque é a mais nova que tem foto: a do assunto, com a foto do veículo e o crédito, sem `referer`.
    const destaque = page.locator("article[data-noticia^='a-']").first();
    await expect(destaque.getByRole("heading", { level: 2 })).toContainText(TITULO_ASSUNTO_FOTO);
    const foto = destaque.locator("img");
    await expect(foto).toHaveAttribute("src", "https://exemplo.invalido/e2e-noticias-foto.jpg");
    await expect(foto).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(destaque.getByText("Foto: [teste] Diário Exemplo")).toBeVisible();
    await expect(destaque.getByText("política", { exact: true })).toBeVisible();
    const link = destaque.getByRole("link", { name: TITULO_ASSUNTO_FOTO });
    await expect(link).toHaveAttribute("href", "https://exemplo.invalido/e2e-noticias-eleicao");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // A do setor, sem foto: o bloco de tipografia com o veículo, e o link para o original.
    const doSetor = page.locator("article", { hasText: TITULO_SETOR_HOJE });
    await expect(doSetor.getByText("[teste] Notícias", { exact: true })).toBeVisible();
    await expect(doSetor.locator("img")).toHaveCount(0);
    await expect(doSetor.getByRole("link", { name: TITULO_SETOR_HOJE })).toHaveAttribute("href", "https://exemplo.invalido/e2e-noticias-setor-hoje");

    // A do setor com a foto do portal (RSS direto): a imagem e o crédito aparecem no cartão, sem `referer`.
    const doSetorComFoto = page.locator("article", { hasText: TITULO_SETOR_FOTO });
    await expect(doSetorComFoto.locator("img")).toHaveAttribute("src", "https://exemplo.invalido/e2e-noticias-setor-foto.jpg");
    await expect(doSetorComFoto.locator("img")).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(doSetorComFoto.getByText("Foto: [teste] Jornal Exemplo")).toBeVisible();

    // O endereço que não é https nunca vira link, e a foto que não é https nunca vira imagem.
    const inseguro = page.locator("article", { hasText: TITULO_ASSUNTO_INSEGURO });
    await expect(inseguro).toBeVisible();
    await expect(inseguro.getByRole("link", { name: TITULO_ASSUNTO_INSEGURO })).toHaveCount(0);
    await expect(inseguro.locator("img")).toHaveCount(0);

    // De ontem, embaixo; a antiga e a não relevante nunca.
    await expect(page.getByRole("heading", { name: "De ontem", exact: true })).toBeVisible();
    await expect(page.locator("article", { hasText: TITULO_SETOR_ONTEM })).toBeVisible();
    await expect(page.getByText(TITULO_ANTIGO)).toHaveCount(0);
    await expect(page.getByText("não relevante")).toHaveCount(0);
  });

  test("as pílulas de origem: o setor, cada assunto e Tudo", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    const grupo = page.getByRole("group", { name: "De onde vêm as notícias" });
    await expect(grupo.getByRole("button", { name: "Tudo" })).toHaveAttribute("aria-pressed", "true");
    await grupo.getByRole("button", { name: "política" }).click();
    await expect(page.locator("article", { hasText: TITULO_ASSUNTO_FOTO })).toBeVisible();
    await expect(page.locator("article", { hasText: TITULO_SETOR_HOJE })).toHaveCount(0);

    await grupo.getByRole("button", { name: "[teste] Notícias" }).click();
    await expect(page.locator("article", { hasText: TITULO_SETOR_HOJE })).toBeVisible();
    await expect(page.locator("article", { hasText: TITULO_ASSUNTO_FOTO })).toHaveCount(0);

    await grupo.getByRole("button", { name: "esporte" }).click();
    await expect(page.locator("[data-sem-novidade]")).toBeVisible();
    await grupo.getByRole("button", { name: "Tudo" }).click();
    await expect(page.locator("article", { hasText: TITULO_SETOR_HOJE })).toBeVisible();
  });

  test("a folha dos assuntos: acrescentar, recusar o repetido, manter o parado e tirar", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    await expect(page.getByText("2 de 5")).toBeVisible();
    await page.getByRole("button", { name: "Editar" }).click();
    const folha = page.getByRole("dialog", { name: "Os assuntos que você acompanha" });
    await expect(folha).toBeVisible();
    await expect(folha.getByText("eleição")).toBeVisible();
    await expect(folha.getByText("Sem notícia aberta há 25 dias. Sai em 5.")).toBeVisible();
    await expect(folha.getByText("Isso vai aparecer nas suas notícias e nos seus roteiros.")).toBeVisible();

    await folha.getByLabel("Assunto", { exact: true }).fill("economia");
    await folha.getByLabel("Palavras que ajudam a achar (opcional)").fill("juros, dólar");
    await folha.getByRole("button", { name: "Acrescentar", exact: true }).click();
    await expect(folha.locator("[data-assunto]").filter({ hasText: "economia" })).toBeVisible();
    await expect(folha.locator("[data-assunto]").filter({ hasText: "juros" })).toBeVisible();

    await folha.getByLabel("Assunto", { exact: true }).fill("ECONOMIA");
    await folha.getByRole("button", { name: "Acrescentar", exact: true }).click();
    await expect(folha.getByRole("alert")).toContainText("já está sendo acompanhado");

    await folha.getByRole("button", { name: "Manter esporte" }).click();
    await expect(folha.getByText("Sem notícia aberta há 25 dias. Sai em 5.")).toHaveCount(0);
    await expect(folha.getByText("Mantido")).toBeVisible();

    await folha.getByRole("button", { name: "Tirar economia" }).click();
    await expect(folha.locator("[data-assunto]").filter({ hasText: "economia" })).toHaveCount(0);

    await folha.getByRole("button", { name: "Pronto" }).click();
    await expect(folha).toHaveCount(0);
    await expect(page.getByText("2 de 5")).toBeVisible();
  });

  test("abrir uma notícia de um assunto mantém o assunto vivo: a abertura fica registrada", async ({ page, context }) => {
    await entrar(page);
    await page.goto("/noticias");

    const [antes] = await db().select().from(assuntosDaMarca).where(and(eq(assuntosDaMarca.clienteId, marcaUmId), eq(assuntosDaMarca.texto, "política")));
    expect(antes.ultimoAbertoEm).toBeNull();

    // O original abre numa aba nova (o endereço de teste não existe: a aba só precisa abrir).
    const abaNova = context.waitForEvent("page");
    await page.locator("article", { hasText: TITULO_ASSUNTO_FOTO }).getByRole("link", { name: TITULO_ASSUNTO_FOTO }).click();
    await (await abaNova).close();

    await expect.poll(async () => (await db().select().from(assuntosDaMarca).where(eq(assuntosDaMarca.id, antes.id)))[0].ultimoAbertoEm).not.toBeNull();
  });

  test("criar roteiro com esta notícia: a do setor vai presa pelo id, a de assunto vai presa pelo id do assunto", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    await page.locator("article", { hasText: TITULO_SETOR_HOJE }).getByRole("button", { name: "Criar roteiro com esta notícia" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?noticiaId=\d+/);
    await expect(page.getByRole("heading", { name: "Criar vídeo com esta notícia" })).toBeVisible();
    await expect(page.getByText(TITULO_SETOR_HOJE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Voltar para as notícias" })).toBeVisible();

    await page.goto("/noticias");
    await page.locator("article[data-noticia^='a-']").first().getByRole("button", { name: "Criar roteiro com esta notícia" }).click();
    // E53 (parte 3): a notícia de um assunto da marca também vai presa (a folha "A notícia"), em vez de o título virar o texto do campo.
    await expect(page).toHaveURL(/\/criar\/tema-livre\?noticiaAssuntoId=\d+/);
    await expect(page.getByRole("heading", { name: "Criar vídeo com esta notícia" })).toBeVisible();
    await expect(page.getByText(TITULO_ASSUNTO_FOTO)).toBeVisible();
    await expect(page.getByLabel("O que você pensou?")).toHaveValue("");
  });

  test("a notícia de um assunto até o roteiro: o roteiro guarda de onde veio e a tela mostra o veículo, o dia e o link", async ({ page }) => {
    test.setTimeout(90_000);
    await entrar(page);
    await page.goto("/noticias");

    await page.locator("article[data-noticia^='a-']").first().getByRole("button", { name: "Criar roteiro com esta notícia" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?noticiaAssuntoId=\d+/);
    await page.getByLabel("O que você pensou?").fill(`Aqui na loja a gente comenta isso toda semana. ${MARCADOR_NOTA_ALTA}`);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=.*noticiaAssuntoId=\d+/);
    await page.getByRole("radio", { name: /Que me chamem/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    const origem = page.locator("[data-noticia-de-origem]");
    await expect(origem).toContainText("Veio de uma notícia:");
    await expect(origem).toContainText("[teste] Diário Exemplo");
    const link = origem.getByRole("link", { name: TITULO_ASSUNTO_FOTO });
    await expect(link).toHaveAttribute("href", "https://exemplo.invalido/e2e-noticias-eleicao");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // O roteiro guarda a cópia (título, veículo, link), não a chave do assunto: ela some com o assunto, o "De onde veio" não.
    const id = Number(new URL(page.url()).pathname.split("/").pop());
    const [guardado] = await db().select({ origem: roteiros.noticiaDoAssunto, noticiaId: roteiros.noticiaId }).from(roteiros).where(eq(roteiros.id, id));
    expect(guardado.noticiaId).toBeNull();
    expect(guardado.origem).toMatchObject({ titulo: TITULO_ASSUNTO_FOTO, veiculo: "[teste] Diário Exemplo", url: "https://exemplo.invalido/e2e-noticias-eleicao" });

    // Tirar o assunto da marca não apaga o "De onde veio" do roteiro.
    await db().delete(assuntosDaMarca).where(eq(assuntosDaMarca.clienteId, marcaUmId));
    await page.reload();
    await expect(page.locator("[data-noticia-de-origem]")).toContainText(TITULO_ASSUNTO_FOTO);
  });

  test("fluxo inteiro: notícia até o roteiro, e a notícia volta marcada 'virou roteiro' só para esta marca", async ({ page }) => {
    test.setTimeout(90_000);
    // O seletor de marca só vira a folha com botões no celular (`garantirMarcaDoisAtiva`); no desktop é um menu da barra lateral.
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/noticias");

    await page.locator("article", { hasText: TITULO_SETOR_HOJE }).getByRole("button", { name: "Criar roteiro com esta notícia" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?noticiaId=\d+/);

    await page.getByLabel("O que você pensou?").fill(`Aqui na loja a gente vê isso toda semana. ${MARCADOR_NOTA_ALTA}`);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=.*noticiaId=\d+/);
    await page.getByRole("radio", { name: /Que me chamem/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    // E53 (parte 3): a tela do roteiro diz de qual notícia do setor ele veio, com o link do original.
    const origemDoSetor = page.locator("[data-noticia-de-origem]");
    await expect(origemDoSetor).toContainText("Veio de uma notícia:");
    await expect(origemDoSetor.getByRole("link", { name: TITULO_SETOR_HOJE })).toHaveAttribute("href", "https://exemplo.invalido/e2e-noticias-setor-hoje");

    // De volta a Notícias, a marca que gerou o roteiro vê "virou roteiro" com o link certo.
    await page.goto("/noticias");
    const cartao = page.locator("article", { hasText: TITULO_SETOR_HOJE });
    await expect(cartao.getByText("virou roteiro")).toBeVisible();
    const linkRoteiro = cartao.getByRole("link", { name: "Ver o roteiro" });
    await expect(linkRoteiro).toBeVisible();
    await linkRoteiro.click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    // A mesma notícia, para a outra marca do mesmo setor, continua sem "virou roteiro" (isolamento), e sem os assuntos da primeira.
    await garantirMarcaDoisAtiva(page);
    await page.goto("/noticias");
    const cartaoOutraMarca = page.locator("article", { hasText: TITULO_SETOR_HOJE });
    await expect(cartaoOutraMarca).toBeVisible();
    await expect(cartaoOutraMarca.getByText("virou roteiro")).toHaveCount(0);
    await expect(cartaoOutraMarca.getByRole("button", { name: "Criar roteiro com esta notícia" })).toBeVisible();
    await expect(page.getByText(TITULO_ASSUNTO_FOTO)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Acompanhe um assunto" })).toBeVisible();

    // E53 (parte 3): o id de uma notícia de assunto da OUTRA marca no endereço não vale (nem prende, nem aparece): a folha "A notícia" não abre.
    const [daOutraMarca] = await db()
      .select({ id: noticiasDoAssunto.id })
      .from(noticiasDoAssunto)
      .innerJoin(assuntosDaMarca, eq(assuntosDaMarca.id, noticiasDoAssunto.assuntoId))
      .where(and(eq(assuntosDaMarca.clienteId, marcaUmId), eq(noticiasDoAssunto.titulo, TITULO_ASSUNTO_FOTO)));
    await page.goto(`/criar/tema-livre?noticiaAssuntoId=${daOutraMarca.id}`);
    await expect(page.getByRole("heading", { name: "Criar vídeo com esta notícia" })).toHaveCount(0);
    await expect(page.getByText(TITULO_ASSUNTO_FOTO)).toHaveCount(0);
  });
});
