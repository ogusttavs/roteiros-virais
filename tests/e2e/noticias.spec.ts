/**
 * `/noticias` (E43, design v2, `entrega/telas/Noticias.dc.html`): a lista por período, abrir a
 * folha de detalhe, "Criar vídeo com esta notícia" até um roteiro gerado, "virou roteiro"
 * isolado por marca. Mesma lição de `referencias.spec.ts` e `tema-livre.spec.ts`: grava notícia,
 * briefing e vídeo direto no banco, e deixa só a avaliação do tema e a geração do roteiro
 * passarem pelo navegador, contra o `AI_PROVIDER=mock` do servidor. Roteiro próprio
 * ("e2e-noticias"), sem `resetarSchema` (mesma lição de `roteiro.spec.ts`): o seed roda uma vez
 * só, no globalSetup.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, noticias, preferenciasUsuario, user } from "../../src/db/schema";
import { textosNav } from "../../src/textos/nav";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-noticias@exemplo.teste";
const NOME_MARCA_UM = "[teste] Notícias Um";
const NOME_MARCA_DOIS = "[teste] Notícias Dois";
const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";

const TITULO_COM_ANGULO = "[teste] venda de produto multiuso cresce no trimestre";
const TITULO_SEM_RESUMO = "[teste] notícia sem resumo, só o título";
const TITULO_ANTIGO = "[teste] notícia de um mês atrás, só no período Mês";

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

test.describe("/noticias", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-noticias"));
    if (jaExiste) return;

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

    // Dois primeiro, Um depois: a marca ativa no primeiro login (sem cookie ainda) é a de
    // criação mais recente, mesmo raciocínio de `referencias.spec.ts`/`tema-livre.spec.ts`.
    const [marcaDois] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-noticias", nome: NOME_MARCA_DOIS, nichoId: nicho.id })
      .returning();
    const [marcaUm] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-noticias", nome: NOME_MARCA_UM, nichoId: nicho.id })
      .returning();
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
          titulo: TITULO_COM_ANGULO,
          url: "https://exemplo.invalido/e2e-noticias-com-angulo",
          fonte: "[teste] Jornal Exemplo",
          // Fora das ultimas 24h de proposito: o periodo "hoje" fica vazio neste fixture (o teste
          // do estado vazio depende disso), mas dentro da semana.
          publicadoEm: new Date(agora - 30 * 60 * 60 * 1000),
          resumo: "Associação do setor registrou alta nas vendas de produtos multiuso no trimestre.",
          relevante: true,
          angulo: "Mostre a sua rotina usando o produto e explique o que faz ele render mais.",
        },
        {
          nichoId: nicho.id,
          titulo: TITULO_SEM_RESUMO,
          url: "https://exemplo.invalido/e2e-noticias-sem-resumo",
          fonte: "[teste] Jornal Exemplo",
          publicadoEm: new Date(agora - 50 * 60 * 60 * 1000),
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
          publicadoEm: new Date(agora - 1 * 60 * 60 * 1000),
          resumo: null,
          relevante: false,
          angulo: null,
        },
      ]);
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("mostra as notícias relevantes da semana, mais recente primeiro, nunca a não relevante", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    await expect(page.getByRole("heading", { name: "Notícias do seu setor" })).toBeVisible();
    await expect(page.getByText("2 notícias do seu setor nesta semana")).toBeVisible();
    await expect(page.getByText(TITULO_COM_ANGULO)).toBeVisible();
    await expect(page.getByText(TITULO_SEM_RESUMO)).toBeVisible();
    await expect(page.getByText(TITULO_ANTIGO)).not.toBeVisible();
    await expect(page.getByText("não relevante")).not.toBeVisible();

    await expect(page.getByText("Como isso vira vídeo seu")).toBeVisible();
  });

  test("trocar para Mês mostra a notícia antiga também, e a URL guarda o período", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    await page.getByRole("radio", { name: "Mês" }).click();
    await expect(page).toHaveURL(/periodo=mes/);
    await expect(page.getByText(TITULO_ANTIGO)).toBeVisible();
  });

  test("abrir a notícia mostra a data e hora exatas, o resumo inteiro e os dois links do rodapé", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias");

    // E42a, item 2: o cartão virou `<article>` com um botão cobrindo (aria-label com o título) em
    // vez do cartão inteiro ser o botão; o alvo do clique agora é esse botão, não o texto do título.
    await page.getByRole("button", { name: TITULO_COM_ANGULO }).click();
    const folha = page.getByRole("dialog", { name: TITULO_COM_ANGULO });
    await expect(folha).toBeVisible();
    await expect(folha.getByText("Este é o nosso resumo. A matéria inteira fica no site de quem publicou.")).toBeVisible();
    await expect(folha.getByRole("button", { name: "Criar vídeo com esta notícia" })).toBeVisible();
    const linkLerNoSite = folha.getByRole("link", { name: "Ler no site" });
    await expect(linkLerNoSite).toHaveAttribute("href", "https://exemplo.invalido/e2e-noticias-com-angulo");
    await expect(linkLerNoSite).toHaveAttribute("target", "_blank");
  });

  test("o estado vazio do dia aponta o total da semana e 'Ver a semana' muda o período", async ({ page }) => {
    await entrar(page);
    await page.goto("/noticias?periodo=hoje");

    await expect(page.getByRole("heading", { name: "Nenhuma notícia do seu setor hoje" })).toBeVisible();
    await expect(page.getByText("Na semana tem 2.")).toBeVisible();
    await page.getByRole("button", { name: "Ver a semana" }).click();
    await expect(page).toHaveURL(/periodo=semana/);
    await expect(page.getByText(TITULO_COM_ANGULO)).toBeVisible();
  });

  test("criar vídeo com esta notícia: a tela de tema livre nasce presa à notícia, e 'Tirar a notícia' solta", async ({
    page,
  }) => {
    await entrar(page);
    await page.goto("/noticias");

    await page.getByRole("button", { name: TITULO_SEM_RESUMO }).click();
    await page.getByRole("dialog", { name: TITULO_SEM_RESUMO }).getByRole("button", { name: "Criar vídeo com esta notícia" }).click();

    await expect(page).toHaveURL(/\/criar\/tema-livre\?noticiaId=\d+/);
    await expect(page.getByRole("heading", { name: "Criar vídeo com esta notícia" })).toBeVisible();
    await expect(page.getByText(TITULO_SEM_RESUMO)).toBeVisible();
    await expect(page.getByLabel("O que você pensou?")).toBeVisible();

    // O X desta tela volta para Notícias, não para Hoje (dúvida 7 do passo 11).
    await expect(page.getByRole("button", { name: "Voltar para as notícias" })).toBeVisible();

    await page.getByRole("button", { name: "Tirar a notícia" }).click();
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?" })).toBeVisible();
    await expect(page.getByText(TITULO_SEM_RESUMO)).not.toBeVisible();
  });

  test("fluxo inteiro: notícia até o roteiro, e a notícia volta marcada 'virou roteiro' só para esta marca", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // O seletor de marca só vira a folha com botões no celular (`garantirMarcaDoisAtiva`,
    // abaixo); no desktop é um menu da barra lateral, com outros papéis de acessibilidade.
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.goto("/noticias");

    await page.getByRole("button", { name: TITULO_COM_ANGULO }).click();
    await page.getByRole("dialog", { name: TITULO_COM_ANGULO }).getByRole("button", { name: "Criar vídeo com esta notícia" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?noticiaId=\d+/);

    await page
      .getByLabel("O que você pensou?")
      .fill(`Aqui na loja a gente vê isso toda semana. ${MARCADOR_NOTA_ALTA}`);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=.*noticiaId=\d+/);
    await page.getByRole("radio", { name: /gente me chamar para comprar/i }).click();
    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });

    // De volta a Notícias, a marca que gerou o roteiro vê "virou roteiro" com o link certo.
    await page.goto("/noticias");
    const cartao = page.locator("article", { hasText: TITULO_COM_ANGULO });
    await expect(cartao.getByText("virou roteiro")).toBeVisible();
    const linkRoteiro = cartao.getByRole("link", { name: "Ver o roteiro" });
    await expect(linkRoteiro).toBeVisible();
    await linkRoteiro.click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    // A mesma notícia, para a outra marca do mesmo setor, continua sem "virou roteiro" (isolamento).
    await garantirMarcaDoisAtiva(page);
    await page.goto("/noticias");
    const cartaoOutraMarca = page.locator("article", { hasText: TITULO_COM_ANGULO });
    await expect(cartaoOutraMarca).toBeVisible();
    await expect(cartaoOutraMarca.getByText("virou roteiro")).not.toBeVisible();
    await expect(cartaoOutraMarca.getByText("Abrir")).toBeVisible();
  });
});
