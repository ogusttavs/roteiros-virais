/**
 * O assunto em alta no Criar, na porta dos temas, no Tema livre, no Objetivo, na tela do roteiro e no Histórico (E55 PR 2, parte b): o cartão no alto da oficina, a lista do que não coube no ramo, o assunto
 * preso ao Tema livre (que se tira), a pergunta "Para quando é?" que some no assunto do momento, o selo e a linha de prazo do roteiro, o aviso de que o assunto passou e o selo do Histórico.
 *
 * O preparo (uma marca num ramo só dela, o tema do momento, a rodada de agora) é o de `ajudas-em-alta.ts`, o mesmo do cartão no Hoje.
 */
import { expect, test } from "@playwright/test";

import { entrar, limparTendencias, prepararMarca, TITULO_DO_TEMA } from "./ajudas-em-alta";
import { ficarComAPrimeiraVersao } from "./ajudas-versoes";

const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";

test.afterAll(limparTendencias);

test.describe("o assunto em alta no Criar", () => {
  test("o cartão fica no alto da oficina, com o botão principal e o 'de outro jeito'; Criar o roteiro leva ao Objetivo com o tema do momento", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria" });
    await entrar(page, email);
    await page.goto("/criar");

    const cartao = page.locator("[data-em-alta]");
    await expect(cartao).toHaveCount(1);
    await expect(cartao.getByRole("heading", { name: assunto, level: 3 })).toBeVisible();
    await expect(cartao).toContainText("Para hoje");
    await expect(cartao.getByRole("heading", { name: TITULO_DO_TEMA, level: 4 })).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Trazer para o meu ramo de outro jeito" })).toBeVisible();
    // O cartão fica antes das quatro portas.
    const caixaDoCartao = await cartao.boundingBox();
    const caixaDaPrimeiraPorta = await page.getByRole("button", { name: /Os temas de hoje/ }).boundingBox();
    expect(caixaDoCartao!.y).toBeLessThan(caixaDaPrimeiraPorta!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "o cartão criou rolagem para o lado").toBe(true);

    await cartao.getByRole("button", { name: "Criar o roteiro" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=\d+/);
    // O assunto do momento é para hoje: a pergunta "Para quando é?" não existe.
    await expect(page.getByRole("heading", { name: /Para quando é\?/ })).toHaveCount(0);
    await expect(page.getByText("Para quando é?")).toHaveCount(0);
  });

  test("quem cria para outro dia (?data=) não vê o cartão, nem a lista do que não coube no ramo", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria" });
    await entrar(page, email);
    const amanha = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.goto(`/criar?data=${amanha}`);
    await expect(page.getByRole("heading", { name: "Criar roteiros" })).toBeVisible();
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
    await expect(page.locator("[data-sem-encaixe]")).toHaveCount(0);
  });

  test("'Trazer para o meu ramo de outro jeito' abre o Tema livre com o assunto preso; Tirar o assunto devolve o Tema livre comum", async ({ page }) => {
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria" });
    await entrar(page, email);
    await page.goto("/criar");
    await page.locator("[data-em-alta]").getByRole("button", { name: "Trazer para o meu ramo de outro jeito" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?alta=/);

    const preso = page.locator("[data-assunto-preso]");
    await expect(preso).toBeVisible();
    await expect(preso).toContainText("Em alta no Brasil, para hoje");
    await expect(preso.getByRole("heading", { name: assunto, level: 3 })).toBeVisible();
    await expect(preso).toContainText("Buscas do Google no Brasil");
    await expect(page.getByRole("heading", { name: "Trazer para o seu ramo", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Como esse assunto cabe no seu ramo?")).toBeVisible();

    await preso.getByRole("button", { name: "Tirar o assunto" }).click();
    await expect(page.locator("[data-assunto-preso]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?", level: 1 })).toBeVisible();
  });

  test("o assunto preso vai do Tema livre até o roteiro: a nota, o Objetivo sem 'Para quando é?', e o roteiro nasce do momento (selo, linha e 'De onde veio')", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria", trafego: "2000+" });
    await entrar(page, email);
    await page.goto("/criar");
    await page.locator("[data-em-alta]").getByRole("button", { name: "Trazer para o meu ramo de outro jeito" }).click();
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Como esse assunto cabe no seu ramo?").fill(MARCADOR_NOTA_ALTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=.*&alta=/);
    await expect(page.getByText("Para quando é?")).toHaveCount(0);
    // Sem tema do dia, nenhuma ficha vem marcada (a recomendação é pelo que a pessoa tem postado): escolhe uma.
    await page.locator("[data-fichas]").getByRole("radio", { name: /Que me chamem/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await ficarComAPrimeiraVersao(page);
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });

    await expect(page.locator("[data-selo-momento='vivo']")).toContainText("Assunto do momento");
    const linha = page.locator("[data-linha-momento]");
    await expect(linha).toContainText(assunto);
    await expect(linha).toContainText("em alta no Brasil");
    await expect(linha).toContainText("Grave hoje: amanhã o assunto pode já ter passado.");
    const deOndeVeio = page.locator("[data-de-onde-veio-momento]");
    await expect(deOndeVeio.getByRole("heading", { name: "De onde veio" })).toBeVisible();
    await expect(deOndeVeio).toContainText("Buscas do Google no Brasil");
    await expect(deOndeVeio).toContainText("mais de 2.000 buscas");
    // O Tema livre não tem a frase do sistema: a ligação com o ramo é a que a pessoa escreveu.
    await expect(deOndeVeio).not.toContainText("A ligação com o seu ramo é nossa");
  });

  test("sem tema do momento e com o setor sem encaixe: a lista dos assuntos que não couberam (sem os delicados), e 'Trazer para o meu ramo' abre o Tema livre com aquele assunto", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email } = await prepararMarca({
      assunto: "Final da copa",
      semTema: true,
      avaliada: "sem_encaixe",
      outros: [
        { assunto: "Eleição municipal", sensivel: true },
        { assunto: "Estreia da novela", trafego: "500K+" },
        { assunto: "Desfile", fonte: "youtube", trafego: null },
        { assunto: "Quarto assunto" },
      ],
    });
    await entrar(page, email);
    await page.goto("/criar");

    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
    const bloco = page.locator("[data-sem-encaixe]");
    await expect(bloco).toBeVisible();
    await expect(bloco.getByRole("heading", { name: "Nada disso cabe bem no seu ramo hoje" })).toBeVisible();
    // Até três, na ordem da lista, sem o delicado.
    await expect(bloco.getByRole("listitem")).toHaveCount(3);
    await expect(bloco).toContainText("Final da copa");
    await expect(bloco).toContainText("Estreia da novela");
    await expect(bloco).not.toContainText("Eleição municipal");
    await expect(bloco).not.toContainText("Quarto assunto");
    await expect(bloco).toContainText("Por isso a gente não sugeriu tema.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "a lista criou rolagem para o lado").toBe(true);

    await bloco.getByRole("button", { name: /^Trazer para o meu ramo: .*Estreia da novela/ }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?alta=/);
    await expect(page.locator("[data-assunto-preso]")).toContainText("Estreia da novela");
  });

  test("sem avaliação do setor (ou com um tema do momento já nascido) o Criar não mostra a lista do que não coube", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", semTema: true });
    await entrar(page, email);
    await page.goto("/criar");
    await expect(page.getByRole("heading", { name: "Criar roteiros" })).toBeVisible();
    await expect(page.locator("[data-sem-encaixe]")).toHaveCount(0);
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
  });

  test("o assunto do momento sozinho nos temas de hoje, para outro dia: a lista não fica em branco, o aviso leva ao assunto próprio", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria", soOMomento: true });
    await entrar(page, email);
    const amanha = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.goto(`/criar/temas?data=${amanha}`);
    await expect(page.getByRole("heading", { name: "Hoje só há o assunto do momento" })).toBeVisible();
    await expect(page.locator("[data-em-alta]")).toHaveCount(0);
    await page.getByRole("button", { name: /Escrever o meu assunto/i }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre/);
  });

  test("o cartão leva o assunto pela chave: se ele sai da lista antes de a pessoa abrir o Objetivo, volta ao Criar, nunca cai em outro tema", async ({ page }) => {
    const { email } = await prepararMarca({ assunto: "Frente fria" });
    await entrar(page, email);
    await page.goto("/criar");
    await page.locator("[data-em-alta]").getByRole("button", { name: "Criar o roteiro" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=\d+&momento=/);
    await page.goto("/criar/objetivo?tema=0&momento=assunto-que-nao-existe");
    await expect(page).toHaveURL(/\/criar$/);
  });

  test("a porta Os temas de hoje tem o cartão no alto, com Quero esse, e o tema do momento não se repete entre os cartões comuns", async ({ page }) => {
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria" });
    await entrar(page, email);
    await page.goto("/criar/temas");

    const cartao = page.locator("[data-em-alta]");
    await expect(cartao).toHaveCount(1);
    await expect(cartao.getByRole("heading", { name: assunto, level: 3 })).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Quero esse" })).toBeVisible();
    // O tema do momento só aparece no cartão: nos cartões comuns há o tema comum e mais nada.
    await expect(page.getByText(TITULO_DO_TEMA)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Quero esse" })).toHaveCount(2);

    await cartao.getByRole("button", { name: "Quero esse" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=\d+/);
  });
});

test.describe("a tela do roteiro e o Histórico", () => {
  test("o roteiro do momento ainda em alta: selo vivo, a linha de prazo e o 'De onde veio' com as duas fontes e a ligação com o ramo", async ({ page }) => {
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje" }, ligacao: "o frio junta umidade onde o ar não passa", trafego: "500K+" });
    await entrar(page, email);
    await page.goto("/hoje");
    await page.locator("[data-em-alta]").getByRole("button", { name: "Abrir o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    await expect(page.locator("[data-selo-momento='vivo']")).toContainText("Assunto do momento");
    await expect(page.locator("[data-linha-momento]")).toContainText(assunto);
    await expect(page.locator("[data-aviso-passou]")).toHaveCount(0);
    const deOndeVeio = page.locator("[data-de-onde-veio-momento]");
    await expect(deOndeVeio).toContainText("mais de 500.000 buscas");
    await expect(deOndeVeio).toContainText("A ligação com o seu ramo é nossa: o frio junta umidade onde o ar não passa");
  });

  test("o assunto que já saiu da lista: o selo fica neutro ('O assunto já passou'), entra o aviso com 'Ver os temas de hoje', e o roteiro continua da pessoa", async ({ page }) => {
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "hoje" }, naLista: false });
    await entrar(page, email);
    await page.goto("/hoje");
    await page.getByRole("button", { name: "Abrir o roteiro" }).first().click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    await expect(page.locator("[data-selo-momento='passou']")).toContainText("O assunto já passou");
    await expect(page.locator("[data-linha-momento]")).toHaveCount(0);
    const aviso = page.locator("[data-aviso-passou]");
    await expect(aviso).toContainText(`${assunto} saiu do que está em alta`);
    await expect(aviso).toContainText("O roteiro continua seu");
    await aviso.getByRole("link", { name: "Ver os temas de hoje" }).click();
    await expect(page).toHaveURL(/\/criar\/temas/);
  });

  test("o roteiro de ontem com o assunto ainda em alta: selo neutro 'Era um assunto do momento', sem dizer que o assunto saiu", async ({ page }) => {
    const { email, assunto, roteiroId } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "ontem" } });
    await entrar(page, email);
    await page.goto(`/roteiros/${roteiroId}`);

    await expect(page.locator("[data-selo-momento='outroDia']")).toContainText("Era um assunto do momento");
    const aviso = page.locator("[data-aviso-passou]");
    await expect(aviso).toContainText(`${assunto} era o assunto do dia em que o roteiro foi escrito`);
    await expect(aviso).not.toContainText("saiu do que está em alta");
  });

  test("o Histórico mostra o selo 'do momento: <assunto>' no roteiro que nasceu de um assunto em alta", async ({ page }) => {
    const { email, assunto } = await prepararMarca({ assunto: "Frente fria", roteiro: { data: "ontem" }, naLista: false });
    await entrar(page, email);
    await page.goto("/historico");
    const selo = page.locator("[data-selo-do-momento]");
    await expect(selo).toHaveCount(1);
    await expect(selo).toContainText(`do momento: ${assunto}`);
  });
});
