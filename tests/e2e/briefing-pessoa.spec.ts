/**
 * P1, o briefing da pessoa (briefing-e-rubricas.md, secao 2b): uma marca do
 * tipo pessoa abre /comecar e ve as perguntas e os dados fixos proprios
 * dela, nunca o texto do negocio. Tambem cobre o item 8 (achado do Gustavo:
 * o Bruno leu o exemplo de "como melhorar" como se fosse a propria
 * resposta): a resposta vem primeiro no campo, a analise abaixo, e "Usar
 * esta sugestao" copia o exemplo para o campo com foco e desfazer.
 *
 * Mesmo cuidado de `briefing.spec.ts`: nunca chama `avaliarResposta` (ou
 * qualquer coisa de `src/ia`) direto no corpo do teste; so pela tela, que
 * herda `AI_PROVIDER=mock` do `webServer.env` do Playwright.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-briefing-pessoa@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("briefing da pessoa (P1)", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-briefing-pessoa"));
    if (jaExiste) return;

    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    await db().insert(user).values({ id: "e2e-briefing-pessoa", name: "[teste] Briefing Pessoa", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-briefing-pessoa-credential",
        issuer: "local:credential",
        accountId: "e2e-briefing-pessoa",
        providerId: "credential",
        userId: "e2e-briefing-pessoa",
        password: await hashPassword(SENHA),
      });
    // Sem cidade (fica em "Onde esta o seu publico"): cai em "intro", exatamente como o teste
    // de layout do desktop faz para o negocio (`layout.spec.ts`, "abrirPassoDoRamo").
    const [cliente] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-briefing-pessoa",
        nome: "Marcos Andrade",
        nichoId: nicho.id,
        tipo: "pessoa",
        persona: "conhecido",
      })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-briefing-pessoa", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-briefing-pessoa", aceitouTermosEm: new Date() });
  });

  test("mostra as perguntas e os dados fixos da pessoa, nunca 'o seu negócio' nem 'diferencial'; negocio continua vendo o de sempre (briefing.spec.ts)", async ({
    page,
  }) => {
    await entrar(page);
    await expect(page).toHaveURL(/\/comecar/);

    // Passo intro: o texto nunca fala de negocio para a pessoa.
    const textoIntro = await page.locator("body").innerText();
    expect(textoIntro).not.toContain("o seu negócio");
    expect(textoIntro).not.toContain("diferencial");

    await page.getByRole("button", { name: "Começar", exact: true }).click();

    // Passo dados fixos: titulo e rotulo proprios da pessoa.
    await expect(page.getByRole("heading", { name: "Sobre você" })).toBeVisible();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Marcos Andrade");
    // "Quem aparece nos vídeos" e fixo e escondido para a pessoa (item 2).
    await expect(page.getByText("Quem aparece nos vídeos")).toBeHidden();
    // A opcao de vender nunca aparece para a pessoa (item 2).
    await expect(page.getByText("Vender o meu produto ou serviço")).toBeHidden();
    await expect(page.getByText("Ficar conhecido no que eu faço")).toBeVisible();

    // V12c, item 1, a E37b: "Onde está o seu público" virou as duas opções (nunca mais um campo de texto).
    await page.getByRole("radio", { name: "No Brasil inteiro" }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    // Bloco 1: a pergunta e o rotulo do bloco sao os da pessoa (secao 2b), nunca os do negocio.
    await expect(page.getByRole("heading", { name: "Sobre você" })).toBeVisible();
    const campoP1 = page.getByLabel("Quem é você e o que você faz hoje");
    await expect(campoP1).toBeVisible();

    const textoBloco1 = await page.locator("body").innerText();
    expect(textoBloco1).not.toContain("o seu negócio");
    expect(textoBloco1).not.toContain("diferencial");

    // Item 8: responde, avalia, e a resposta continua no campo, com a analise abaixo.
    const resposta = "Sou dono de academias e crio conteúdo sobre rotina, treino e os bastidores do negócio.";
    await campoP1.fill(resposta);
    // As doze perguntas ficam montadas o tempo todo (V7, item 4 do PROXIMO.md); p2 e p3, do
    // mesmo bloco, tambem mostram "Avaliar esta resposta" (desabilitado, sem texto ainda).
    await page.getByRole("button", { name: "Avaliar esta resposta" }).first().click();
    await expect(page.getByText("O que está bom")).toBeVisible();

    // A resposta continua no campo (vem primeiro, acima da analise), nao foi substituida por nada.
    await expect(campoP1).toHaveValue(resposta);

    // O exemplo de "como melhorar" tem rotulo visivel de sugestao, nunca parece a resposta da pessoa
    // (E37a, item 2: a sugestao saiu para um componente proprio, com cara de sugestao, nao de campo).
    await expect(page.getByText("Sugestão de resposta")).toBeVisible();
    const botaoUsarSugestao = page.getByRole("button", { name: "Usar esta sugestão" });
    await expect(botaoUsarSugestao).toBeVisible();

    await botaoUsarSugestao.click();

    // O campo passa a ter o texto do exemplo (o mock de avaliarResposta sempre devolve o mesmo texto,
    // src/ia/mock.ts, mockAvaliarResposta) e o foco vai para ele.
    const exemploMock =
      "Eu vendo o meu produto principal por um preco fixo, e mostro para o cliente exatamente o que ele leva junto, com um exemplo real de quem comprou essa semana.";
    // (texto do mock, sem acento, `src/ia/mock.ts`, `mockAvaliarResposta`)
    await expect(campoP1).toHaveValue(exemploMock);
    await expect(campoP1).toBeFocused();

    // O toast avisa a troca e oferece desfazer, que devolve o texto de antes.
    await expect(page.getByText("Resposta substituída pela sugestão")).toBeVisible();
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(campoP1).toHaveValue(resposta);
  });
});
