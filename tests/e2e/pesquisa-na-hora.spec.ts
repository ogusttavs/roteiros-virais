/**
 * Pesquisar antes de escrever (E54, parte 3, passo 22), de ponta a ponta: o campo no Tema livre e na folha do momento, a tela da pesquisa (a espera, os dados com o trecho e o link, a
 * premissa, a posição, o "não achamos" e o erro), o objetivo com a pesquisa presa, o roteiro com o "Atenção", o "pode aparecer" e as "Fontes", o "Voltar depois" e o teto do dia.
 *
 * A pesquisa roda na fila (um worker que o e2e não sobe); o teste a CONCLUI escrevendo o resultado direto no banco, do jeito que `executarPesquisa` o deixaria. Nenhuma chamada paga, e
 * nenhum provedor de IA é tocado por esta parte (o roteiro usa a IA simulada do servidor do teste).
 */
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { clientes, pesquisasNaHora, roteiros, user, type AchadoDaPesquisa, type DestinoDaPesquisa } from "../../src/db/schema";

import { ficarComAPrimeiraVersao } from "./ajudas-versoes";
import { entrar, prepararMarcaComVozes } from "./ajudas-vozes";

const MARCADOR_NOTA = "aprova este tema de teste sem ressalva";
const PEDIDO = "quanto subiu o preço dos produtos de limpeza este ano";

function achado(id: number, extra: Partial<AchadoDaPesquisa> = {}): AchadoDaPesquisa {
  return {
    id,
    texto: id === 1 ? "Os produtos de limpeza ficaram 9,4% mais caros em 12 meses." : id === 2 ? "A inflação de tudo, no mesmo período, foi de 4,1%." : `Dado de teste número ${id}.`,
    fonteNome: id === 1 || id === 2 ? "IBGE" : "Diário Nacional",
    fonteTipo: id === 1 || id === 2 ? "oficial" : "imprensa",
    url: `https://exemplo.gov.br/pesquisa/${id}`,
    titulo: null,
    dataDaPagina: "2026-08-31",
    dataTexto: "August 31, 2026",
    antigo: false,
    citacao: `Trecho da própria fonte do dado ${id}.`,
    ...extra,
  };
}

const ACHADOS = [achado(1), achado(2), achado(3), achado(4, { antigo: true, dataDaPagina: "2024-01-10" })];

/** Escreve o resultado da pesquisa no banco, como `executarPesquisa` o deixaria. */
async function concluir(id: number, extra: Partial<typeof pesquisasNaHora.$inferInsert> = {}) {
  await db()
    .update(pesquisasNaHora)
    .set({ status: "pronta", achados: ACHADOS, selecionados: [1, 2, 3], buscas: 3, custoUsd: "0.05", terminadoEm: new Date(), ...extra })
    .where(eq(pesquisasNaHora.id, id));
}

/** Uma pesquisa já pronta da marca, para as telas que não precisam passar pela criação. */
async function semear(marcaId: number, destino: DestinoDaPesquisa | null, extra: Partial<typeof pesquisasNaHora.$inferInsert> = {}) {
  const [linha] = await db()
    .insert(pesquisasNaHora)
    .values({ clienteId: marcaId, pedido: PEDIDO, tema: "o preço subiu", destino, status: "pronta", achados: ACHADOS, selecionados: [1, 2, 3], buscas: 3, custoUsd: "0.05", terminadoEm: new Date(), ...extra })
    .returning();
  return linha.id;
}

async function idDaUltima(marcaId: number): Promise<number> {
  const linhas = await db().select({ id: pesquisasNaHora.id }).from(pesquisasNaHora).where(eq(pesquisasNaHora.clienteId, marcaId));
  return Math.max(...linhas.map((l) => l.id));
}

async function semRolagemDeLado(page: Page, o: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), o).toBe(true);
}

test.describe("o campo no Tema livre", () => {
  test("depois da nota aparece a linha fechada; aberta diz o tempo, o custo e as pesquisas do dia; 'Tirar' volta ao botão de sempre", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar/tema-livre");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /Pesquisar antes de escrever/ })).toHaveCount(0);

    await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();

    const linha = page.getByRole("button", { name: /Pesquisar antes de escrever/ });
    await expect(linha).toBeVisible();
    await expect(page.getByText("Opcional. Dados de verdade, com a fonte, no seu vídeo.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Escrever o roteiro" })).toBeVisible();

    await linha.click();
    const aberto = page.locator('[data-pesquisar="aberto"]');
    await expect(aberto.getByText(/A rápida leva de 30 segundos a 1 minuto e meio, custa uns R\$ \d,\d{2} e usa 1 das 3 pesquisas do seu dia\./)).toBeVisible();
    await expect(aberto.getByText(/Mais a fundo leva até 2 minutos, custa uns R\$ \d,\d{2} e usa 2\./)).toBeVisible();
    await expect(aberto.getByText("Hoje você ainda tem as 3.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pesquisar e escrever" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Escrever o roteiro" })).toHaveCount(0);
    await semRolagemDeLado(page, "o campo da pesquisa criou rolagem para o lado");

    await aberto.getByRole("button", { name: "Tirar" }).click();
    await expect(page.getByRole("button", { name: "Escrever o roteiro" })).toBeVisible();
  });

  test("pedido curto: a frase fica junto do campo e nada é criado", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar/tema-livre");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await page.getByRole("button", { name: /Pesquisar antes de escrever/ }).click();
    await page.getByRole("textbox", { name: "O que pesquisar" }).fill("preço");
    await page.getByRole("button", { name: "Pesquisar e escrever" }).click();
    await expect(page.getByText("Escreva em uma frase o que você quer pesquisar.")).toBeVisible();
    expect(await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.clienteId, marcaId))).toHaveLength(0);
  });

  test("com as pesquisas do dia gastas, o campo vira um aviso calmo e o botão é o de sempre", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    for (let i = 0; i < 3; i += 1) await semear(marcaId, null);
    await entrar(page, email);
    await page.goto("/criar/tema-livre");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();

    const aviso = page.locator('[data-pesquisar="sem-saldo"]');
    await expect(aviso).toContainText("Você já usou as 3 pesquisas de hoje.");
    await expect(aviso).toContainText("Amanhã tem mais.");
    await expect(aviso.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Escrever o roteiro" })).toBeVisible();
  });
});

test.describe("do pedido ao roteiro, pelo Tema livre", () => {
  test("pede, espera, marca, escreve; o objetivo leva a pesquisa e o roteiro sai com o Atenção, o que pode aparecer e as fontes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { email, marcaId } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar/tema-livre");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();

    await page.getByRole("button", { name: /Pesquisar antes de escrever/ }).click();
    await page.getByRole("textbox", { name: "O que pesquisar" }).fill(PEDIDO);
    await page.getByRole("button", { name: "Pesquisar e escrever" }).click();

    // A espera: a claquete com o pedido, e a pesquisa vive na fila (o teste a conclui no banco).
    await expect(page).toHaveURL(/\/criar\/pesquisa\/\d+/);
    const espera = page.locator("[data-pesquisando]");
    await expect(espera).toBeVisible();
    await expect(espera).toContainText("Pesquisando");
    await expect(espera).toContainText(PEDIDO);
    const id = await idDaUltima(marcaId);
    const [criada] = await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.id, id));
    expect(criada).toMatchObject({ status: "pesquisando", pedido: PEDIDO, profundidade: "normal" });
    expect(criada.destino).toMatchObject({ tipo: "objetivo", consulta: { livre: MARCADOR_NOTA } });

    await concluir(id);
    await expect(page.getByRole("heading", { name: "O que a pesquisa achou", level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("4 dados em 2 fontes")).toBeVisible();
    await expect(page.getByText("3 marcados")).toBeVisible();
    const primeiro = page.locator('[data-achado="1"]');
    await expect(primeiro).toContainText("Os produtos de limpeza ficaram 9,4% mais caros em 12 meses.");
    await expect(primeiro).toContainText("Trecho da própria fonte do dado 1.");
    await expect(primeiro).toContainText("órgão oficial");
    await expect(primeiro.getByRole("link", { name: /Abrir a fonte/ })).toHaveAttribute("href", "https://exemplo.gov.br/pesquisa/1");
    await expect(page.locator('[data-achado="4"]')).toContainText("De mais de 1 ano");
    await expect(page.getByText(/Hoje você já usou 1 das 3 pesquisas do dia\./)).toBeVisible();

    await page.getByRole("button", { name: "Escrever com estes 3" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/objetivo\\?livre=.*&pesquisa=${id}`));
    await expect(page.getByText("Com pesquisa: 3 dados")).toBeVisible();
    await page.locator("[data-fichas]").getByRole("radio", { name: /Que me chamem/ }).click();
    await page.getByRole("button", { name: "escrever o roteiro" }).click();
    await ficarComAPrimeiraVersao(page);
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });

    // O roteiro com pesquisa: o selo, o Atenção antes dos blocos, o que pode aparecer e as fontes com o link.
    await expect(page.locator("[data-selo-pesquisa]")).toContainText("Com pesquisa: 3 dados");
    const atencao = page.locator("[data-atencao-da-pesquisa]");
    const blocos = page.locator("[data-bloco-de-fala]").first();
    await expect(blocos).toBeVisible();
    if ((await atencao.count()) > 0) {
      const topoAtencao = (await atencao.boundingBox())!.y;
      const topoBlocos = (await blocos.boundingBox())!.y;
      expect(topoAtencao, "o Atenção vem antes dos blocos").toBeLessThan(topoBlocos);
    }
    const respostas = page.locator("[data-respostas-da-pesquisa]");
    await expect(respostas.getByRole("heading", { name: "O que pode aparecer" })).toBeVisible();
    await expect(respostas.locator("dt").first()).toContainText("Pode aparecer:");
    const fontes = page.locator("[data-fontes-da-pesquisa]");
    await expect(fontes.getByRole("heading", { name: "Fontes" })).toBeVisible();
    await expect(fontes.getByRole("link", { name: /Abrir a fonte/ }).first()).toHaveAttribute("href", /^https:\/\/exemplo\.gov\.br\/pesquisa\/\d$/);
    await expect(fontes).toContainText("O roteiro só usa número que está aqui.");
    // a lista mostra o número que a fala usa ao lado da frase (o marcador da lista some com `display: grid`, então ele é desenhado)
    const marcador = await fontes.locator('li[data-fonte-numero="1"]').evaluate((el) => getComputedStyle(el, "::before").content);
    expect(marcador).toBe('"1"');
    await expect(page.locator("[data-ref-fonte]").first()).toBeVisible();

    // A cópia que o roteiro guardou
    const [roteiro] = await db().select({ copia: roteiros.pesquisaNaHora }).from(roteiros).where(eq(roteiros.clienteId, marcaId));
    expect(roteiro.copia?.pesquisaId).toBe(id);
    expect(roteiro.copia?.dados.map((d) => d.id)).toEqual([1, 2, 3]);
  });
});

test.describe("a tela da pesquisa", () => {
  test("a premissa que não bate: o aviso antes da lista, o terceiro caminho, e a posição só quando falta", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, marcaId } = await prepararMarcaComVozes();
    const id = await semear(
      marcaId,
      { tipo: "objetivo", consulta: { livre: "o preço do sabão em pó dobrou" } },
      {
        premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: o preço subiu 9,4%, não dobrou.", anguloSugerido: "Fale da alta de 9,4% e de quem troca de marca.", achadoIds: [1] },
        perguntaDePosicao: { pergunta: "Para você, de quem é a culpa da alta?", opcoes: ["Do fabricante", "Dos dois", "Prefiro não dar opinião"] },
      },
    );
    await entrar(page, email);
    await page.goto(`/criar/pesquisa/${id}`);

    await expect(page.getByText("O que você escreveu não bate com as fontes", { exact: true })).toBeVisible();
    await expect(page.getByText(/o preço subiu 9,4%, não dobrou\./)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Escrever com o que as fontes dizem/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: /Seguir com o que eu escrevi, mesmo assim/ }).click();
    await expect(page.getByText(/quem responde pelo que é dito é você/)).toBeVisible();
    await semRolagemDeLado(page, "a premissa criou rolagem para o lado");

    await page.getByRole("button", { name: "Escrever com estes 3" }).click();
    await expect(page.getByRole("heading", { name: "Uma pergunta antes de escrever", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Para você, de quem é a culpa da alta?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Escrever o roteiro" })).toBeDisabled();
    await page.getByRole("radio", { name: "Prefiro não dar opinião" }).click();
    await page.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(new RegExp(`/criar/objetivo\\?livre=.*&pesquisa=${id}`));
    const [linha] = await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.id, id));
    expect(linha).toMatchObject({ decisaoDaPremissa: "manter", posicaoDaPessoa: "Prefiro não dar opinião", selecionados: [1, 2, 3] });
    expect(linha.confirmadaEm).not.toBeNull();
  });

  test("'Mudar o que eu escrevi' volta ao Tema livre com o texto da pessoa", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    const id = await semear(
      marcaId,
      { tipo: "objetivo", consulta: { livre: "o preço do sabão em pó dobrou" } },
      { premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: subiu 9,4%.", anguloSugerido: null, achadoIds: [1] } },
    );
    await entrar(page, email);
    await page.goto(`/criar/pesquisa/${id}`);
    await page.getByRole("radio", { name: /Mudar o que eu escrevi/ }).click();
    await page.getByRole("button", { name: "Voltar e mudar o que escrevi" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre\?tema=/);
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue("o preço do sabão em pó dobrou");
  });

  test("marcar e desmarcar: o botão acompanha, e sem nenhum dado marcado não escreve", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    const id = await semear(marcaId, { tipo: "objetivo", consulta: { livre: "o preço subiu" } });
    await entrar(page, email);
    await page.goto(`/criar/pesquisa/${id}`);
    await page.getByRole("checkbox", { name: /Dado de teste número 3\./ }).click();
    await expect(page.getByText("2 marcados")).toBeVisible();
    await page.getByRole("checkbox", { name: /A inflação de tudo/ }).click();
    await page.getByRole("checkbox", { name: /Os produtos de limpeza ficaram/ }).click();
    await expect(page.getByText("0 marcados")).toBeVisible();
    await expect(page.getByRole("button", { name: "Marque pelo menos um dado para escrever" })).toBeDisabled();
  });

  test("sem achados e erro: a frase em língua de gente e os dois caminhos", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    const vazia = await semear(marcaId, { tipo: "objetivo", consulta: { livre: "o preço subiu" } }, { status: "sem_achados", achados: [], selecionados: [] });
    const quebrada = await semear(marcaId, { tipo: "objetivo", consulta: { livre: "o preço subiu" } }, { status: "erro", achados: [], selecionados: [], buscas: 0, motivo: "A pesquisa não terminou. Tente de novo em alguns minutos, ou escreva sem pesquisa." });
    await entrar(page, email);

    await page.goto(`/criar/pesquisa/${vazia}`);
    await expect(page.getByRole("heading", { name: "Não achamos dado confiável sobre isso", level: 1 })).toBeVisible();
    await expect(page.getByText(/portais grandes e órgãos oficiais, nada com data respondeu isso\./)).toBeVisible();
    await page.getByRole("button", { name: "Escrever sem pesquisa" }).click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=/);
    expect(page.url()).not.toContain("pesquisa=");

    await page.goto(`/criar/pesquisa/${quebrada}`);
    await expect(page.getByRole("heading", { name: "A pesquisa não terminou", level: 1 })).toBeVisible();
    await expect(page.getByText("A falha foi nossa. O seu pedido continua aqui.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  });

  test("a pesquisa de outra marca não abre", async ({ page }) => {
    const { email } = await prepararMarcaComVozes();
    // Outra pessoa, com a marca dela e uma pesquisa pronta (nunca abre para quem não é dela).
    const sufixo = `${test.info().testId}-r${test.info().retry}`;
    await db().insert(user).values({ id: `e2e-pesq-outra-${sufixo}`, name: "[teste] Outra", email: `e2e-pesq-outra-${sufixo}@exemplo.teste` });
    const [outra] = await db().insert(clientes).values({ usuarioId: `e2e-pesq-outra-${sufixo}`, nome: "[teste] Outra marca" }).returning();
    const idDela = await semear(outra.id, null);
    await entrar(page, email);
    const resposta = await page.goto(`/criar/pesquisa/${idDela}`);
    expect(resposta?.status()).toBe(404);
  });

  test("'Voltar depois': o Criar diz que a pesquisa está lá, e dali a pessoa volta para ela", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    const id = await semear(marcaId, { tipo: "objetivo", consulta: { livre: "o preço subiu" } }, { status: "pesquisando", achados: [], selecionados: [], buscas: 0, terminadoEm: null });
    await entrar(page, email);
    await page.goto(`/criar/pesquisa/${id}`);
    await page.locator("[data-pesquisando]").getByRole("button", { name: "Voltar depois" }).click();
    await expect(page).toHaveURL(/\/criar$/);

    const linha = page.locator('[data-pesquisa-em-aberto="pesquisando"]');
    await expect(linha).toContainText(`Pesquisando: ${PEDIDO}`);
    await concluir(id);
    await page.reload();
    const pronta = page.locator('[data-pesquisa-em-aberto="pronta"]');
    await expect(pronta).toContainText("Sua pesquisa está pronta");
    await pronta.getByRole("button", { name: "Ver o que achamos" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/pesquisa/${id}$`));
    await expect(page.getByRole("heading", { name: "O que a pesquisa achou", level: 1 })).toBeVisible();
  });
});

test.describe("a pesquisa que terminou mal enquanto a pessoa estava fora", () => {
  test("o Criar diz que não deu, e some depois que a pessoa abre a pesquisa e vê como terminou", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    const id = await semear(marcaId, { tipo: "objetivo", consulta: { livre: "o preço subiu" } }, { status: "erro", achados: [], selecionados: [], buscas: 0, motivo: "A pesquisa não terminou. Tente de novo em alguns minutos, ou escreva sem pesquisa." });
    await entrar(page, email);
    await page.goto("/criar");
    const linha = page.locator('[data-pesquisa-em-aberto="erro"]');
    await expect(linha).toContainText(`A pesquisa não terminou: ${PEDIDO}`);
    await linha.getByRole("button", { name: "Ver o que achamos" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar/pesquisa/${id}$`));
    await expect(page.getByRole("heading", { name: "A pesquisa não terminou", level: 1 })).toBeVisible();

    await page.goto("/criar");
    await expect(page.locator("[data-pesquisa-em-aberto]")).toHaveCount(0);
  });
});

test.describe("o objetivo com a pesquisa presa", () => {
  test("a pesquisa pronta aparece no selo; a que ainda roda leva de volta à tela dela; a de outra marca é como se não existisse", async ({ page }) => {
    const { email, marcaId } = await prepararMarcaComVozes();
    const pronta = await semear(marcaId, null);
    const rodando = await semear(marcaId, null, { status: "pesquisando", achados: [], selecionados: [], buscas: 0, terminadoEm: null });
    const sufixo = `${test.info().testId}-r${test.info().retry}`;
    await db().insert(user).values({ id: `e2e-pesq-obj-${sufixo}`, name: "[teste] Outra", email: `e2e-pesq-obj-${sufixo}@exemplo.teste` });
    const [outra] = await db().insert(clientes).values({ usuarioId: `e2e-pesq-obj-${sufixo}`, nome: "[teste] Outra marca" }).returning();
    const deOutra = await semear(outra.id, null);
    await entrar(page, email);

    await page.goto(`/criar/objetivo?livre=o+pre%C3%A7o+subiu&pesquisa=${pronta}`);
    await expect(page.getByText("Com pesquisa: 3 dados")).toBeVisible();

    await page.goto(`/criar/objetivo?livre=o+pre%C3%A7o+subiu&pesquisa=${rodando}`);
    await expect(page).toHaveURL(new RegExp(`/criar/pesquisa/${rodando}$`));

    await page.goto(`/criar/objetivo?livre=o+pre%C3%A7o+subiu&pesquisa=${deOutra}`);
    await expect(page).toHaveURL(/\/criar\/objetivo/);
    await expect(page.getByText(/Com pesquisa:/)).toHaveCount(0);
  });
});

test.describe("o momento", () => {
  test("pelo 'Contar o momento': a folha cria a pesquisa, e depois de marcar o roteiro é escrito na própria tela da pesquisa", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email, marcaId } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Contar o momento" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("na loja, uma manhã de segunda");
    await folha.getByLabel("O que está acontecendo").fill("um cliente reclama que o preço do produto subiu");
    await folha.getByLabel("O que dá para mostrar").fill("a etiqueta da prateleira");
    await folha.getByRole("button", { name: "Que me chamem" }).click();

    await folha.getByRole("button", { name: /Pesquisar antes de escrever/ }).click();
    await folha.getByRole("textbox", { name: "O que pesquisar" }).fill(PEDIDO);
    await folha.getByRole("button", { name: "Pesquisar e escrever" }).click();

    await expect(page).toHaveURL(/\/criar\/pesquisa\/\d+/);
    const id = await idDaUltima(marcaId);
    const [criada] = await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.id, id));
    expect(criada.tema).toBe("na loja, uma manhã de segunda. um cliente reclama que o preço do produto subiu. a etiqueta da prateleira");
    expect(criada.destino).toMatchObject({ tipo: "momento", dados: { onde: "na loja, uma manhã de segunda", objetivo: "conversao" } });

    await concluir(id);
    await expect(page.getByRole("heading", { name: "O que a pesquisa achou", level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Escrever com estes 3" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });
    await expect(page.locator("[data-selo-pesquisa]")).toContainText("Com pesquisa: 3 dados");
    await expect(page.locator("[data-fontes-da-pesquisa]")).toBeVisible();
  });

  test("a folha traz o campo fechado e o botão continua 'Escrever o roteiro' até a pessoa abrir; 'Tirar' devolve o botão", async ({ page }) => {
    const { email } = await prepararMarcaComVozes();
    await entrar(page, email);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Contar o momento" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha.getByRole("button", { name: "Escrever o roteiro" })).toBeVisible();
    await folha.getByRole("button", { name: /Pesquisar antes de escrever/ }).click();
    await expect(folha.getByRole("button", { name: "Pesquisar e escrever" })).toBeVisible();
    await expect(folha.getByRole("button", { name: "Escrever o roteiro" })).toHaveCount(0);
    await folha.getByRole("button", { name: "Tirar" }).click();
    await expect(folha.getByRole("button", { name: "Escrever o roteiro" })).toBeVisible();
  });
});
