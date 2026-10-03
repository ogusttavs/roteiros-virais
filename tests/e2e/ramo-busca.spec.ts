/**
 * E45, PR 1: a busca instantânea de ramo no Começar e na Conta. A pessoa digita uma palavra ou uma letra e os ramos aparecem na hora,
 * agrupados; o Enter escolhe o primeiro; sem resultado, "Não achei o meu". Escolher um ramo sem setor ainda cria o setor dele
 * (e só então); trocar de ramo na Conta mostra o que muda.
 *
 * Mesmo cuidado dos outros specs de Começar: nunca chama `src/ia` direto, só pela tela, contra o `AI_PROVIDER=mock` do servidor; um
 * cliente por teste que grava (a escolha grava de verdade, e o segundo teste acharia o passo já completo).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, pedidosDeRamo, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
/** Nenhum ramo do catálogo reconhece estas palavras (nem pelo nome, nem pelos exemplos, nem pelas palavras que levam ao ramo). */
const TEXTO_SEM_RAMO = "xyzw abcd";

const EMAIL_LEITURA = "e2e-ramo-leitura@exemplo.teste";
const EMAIL_SALVA = "e2e-ramo-salva@exemplo.teste";
const EMAIL_OUTRO = "e2e-ramo-outro@exemplo.teste";
const EMAIL_CONTA = "e2e-ramo-conta@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

/** Entra e abre o passo "Sobre você" do Começar (a marca ainda não tem dados fixos). */
async function abrirPassoDoRamo(page: Page, email: string) {
  await entrar(page, email);
  await expect(page).toHaveURL(/\/comecar/);
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ramo" })).toBeVisible();
}

function campoDoRamo(page: Page) {
  return page.getByRole("combobox", { name: "Ramo" });
}

async function criarUsuario(usuarioId: string, email: string, nome: string, opcoes: { nichoId?: number; completa?: boolean } = {}) {
  await db().insert(user).values({ id: usuarioId, name: nome, email });
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
  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome,
      nichoId: opcoes.nichoId,
      tipo: "negocio",
      persona: "negocio",
      alcance: opcoes.completa ? "brasil" : undefined,
    })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  if (opcoes.completa) {
    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "bolos de aniversário",
            preco: "bolo de 1 kg por 120 reais",
            clienteIdeal: "mãe de criança pequena",
            medos: [],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: [],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "faz bolos de aniversário sob encomenda",
          referencias: [],
        },
      });
  }
  return cliente.id;
}

test.describe("E45 PR 1: a busca instantânea de ramo", () => {
  let clienteContaId: number;

  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): a primeira passada já criou tudo.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-ramo-leitura"));
    if (jaExiste) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-ramo-conta"));
      clienteContaId = marca.id;
      return;
    }

    // O setor semeado dos dentistas está encaixado no ramo Odontologia (`scripts/semear.ts`).
    const [dentistas] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    await criarUsuario("e2e-ramo-leitura", EMAIL_LEITURA, "[teste] Ramo leitura");
    await criarUsuario("e2e-ramo-salva", EMAIL_SALVA, "[teste] Ramo salva");
    await criarUsuario("e2e-ramo-outro", EMAIL_OUTRO, "[teste] Ramo outro");
    clienteContaId = await criarUsuario("e2e-ramo-conta", EMAIL_CONTA, "[teste] Ramo conta", { nichoId: dentistas.id, completa: true });
  });

  test("as quatro palavras da ordem caem no ramo certo: dentista, piloto, envelopamento e dieta", async ({ page }) => {
    await abrirPassoDoRamo(page, EMAIL_LEITURA);
    const campo = campoDoRamo(page);

    for (const [digitado, nome] of [
      ["dentista", "Odontologia"],
      ["piloto", "Automobilismo e pilotagem"],
      ["envelopamento", "Estética automotiva"],
      ["dieta", "Nutrição"],
    ]) {
      await campo.fill(digitado);
      const primeira = page.getByRole("option").first();
      await expect(primeira).toContainText(nome);
      await expect(primeira).toHaveAttribute("aria-selected", "true");
    }
  });

  test("ao tocar no campo a lista abre com o catálogo em grupos; uma letra já filtra; sem acento e sem maiúscula", async ({ page }) => {
    await abrirPassoDoRamo(page, EMAIL_LEITURA);
    const campo = campoDoRamo(page);

    await campo.click();
    await expect(page.getByRole("listbox", { name: "Ramos" })).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(44);
    await expect(page.getByRole("group")).toHaveCount(9);
    await expect(page.getByRole("group", { name: "Casa e limpeza" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Perfil pessoal" })).toBeVisible();

    await campo.fill("d");
    const comUmaLetra = await page.getByRole("option").count();
    expect(comUmaLetra).toBeGreaterThan(10);
    expect(comUmaLetra).toBeLessThan(45);

    await campo.fill("ESTETICA");
    await expect(page.getByRole("option", { name: /Estética automotiva/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Estética e pele/ })).toBeVisible();
  });

  test("pelo teclado: seta para baixo anda pela lista, o Enter escolhe sem enviar o formulário, o Esc fecha só a lista", async ({ page }) => {
    await abrirPassoDoRamo(page, EMAIL_LEITURA);
    const campo = campoDoRamo(page);
    // O resto do formulário pronto: um Enter que ENVIASSE o formulário mudaria de passo, e o teste veria (sem o "onde", o envio só mostraria um erro).
    await page.getByRole("radio", { name: "No Brasil inteiro" }).click();

    await campo.fill("est");
    const opcoes = page.getByRole("option");
    await expect(opcoes.first()).toHaveAttribute("aria-selected", "true");
    await campo.press("ArrowDown");
    await expect(opcoes.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(campo).toBeFocused();

    const nomeDaSegunda = (await opcoes.nth(1).locator("span").first().textContent()) ?? "";
    await campo.press("Enter");
    // O Enter escolheu o destacado e NÃO enviou o formulário (ainda estamos no passo, o campo mostra o ramo).
    await expect(campo).toHaveValue(nomeDaSegunda);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sobre o seu negócio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sobre o negócio" })).toHaveCount(0);

    await campo.fill("xyz");
    await expect(page.getByRole("listbox")).toBeVisible();
    await campo.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(campo).toHaveValue(nomeDaSegunda);
    await expect(page.getByRole("heading", { name: "Sobre o seu negócio" })).toBeVisible();
  });

  test("sem resultado: diz o que não casou, oferece 'Não achei o meu', e o texto digitado vira o começo do campo de texto livre", async ({ page }) => {
    await abrirPassoDoRamo(page, EMAIL_OUTRO);
    const campo = campoDoRamo(page);

    // Um texto que nenhum ramo do catálogo reconhece (E45 PR 2: "criação de abelhas" já cai em Agro e campo, e é o caso do `ramo-pedido.spec.ts`).
    await campo.fill(TEXTO_SEM_RAMO);
    await expect(page.getByText(`Nenhum ramo começa com “${TEXTO_SEM_RAMO}”.`)).toBeVisible();
    const naoAchei = page.getByRole("option", { name: /Não achei o meu/ });
    await expect(naoAchei).toBeVisible();
    await naoAchei.click();

    const textoLivre = page.getByLabel("Qual é o seu ramo");
    await expect(textoLivre).toBeVisible();
    await expect(textoLivre).toHaveValue(TEXTO_SEM_RAMO);
    await expect(textoLivre).toBeFocused();
    await expect(campo).toHaveValue("Não achei o meu");

    // Esvaziar o texto livre impede de continuar (a marca precisa de um ramo ou do que a pessoa escreveu).
    await textoLivre.fill("");
    await page.getByRole("radio", { name: "No Brasil inteiro" }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Escreva o seu ramo")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sobre o seu negócio" })).toBeVisible();

    // Escrito, passa, e o texto fica guardado como pedido de ramo aberto. Nenhum ramo se parece com ele (E45 PR 2): a marca fica sem setor, e o
    // admin decide (nada novo é pesquisado por um texto livre).
    await textoLivre.fill(TEXTO_SEM_RAMO);
    await expect(page.getByText(/enquanto a gente confere o seu ramo/)).toHaveCount(0);
    await expect(page.locator("[data-aviso-ramo-provisorio]")).toHaveText(
      "A gente vai conferir o seu ramo. Até lá, os temas e as referências do seu ramo ainda não aparecem.",
    );
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sobre o negócio" })).toBeVisible();
    const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, "e2e-ramo-outro"));
    expect(marca.ramoOutro).toBe(TEXTO_SEM_RAMO);
    expect(marca.nichoId).toBeNull();
    const pedidos = await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.clienteId, marca.id));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ texto: TEXTO_SEM_RAMO, estado: "aberto", setorProvisorioId: null });
  });

  test("escolher um ramo sem setor cria o setor dele, a marca entra nele, e voltar ao passo mostra o ramo escolhido", async ({ page }) => {
    expect(await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "automobilismo-e-pilotagem"))).toHaveLength(0);

    await abrirPassoDoRamo(page, EMAIL_SALVA);
    await campoDoRamo(page).fill("piloto");
    await campoDoRamo(page).press("Enter");
    await expect(campoDoRamo(page)).toHaveValue("Automobilismo e pilotagem");

    // Sem a pergunta de "onde" respondida, "Continuar" não passa; com ela, passa e grava.
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sobre o seu negócio" })).toBeVisible();
    await page.getByRole("radio", { name: "No Brasil inteiro" }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sobre o negócio" })).toBeVisible();

    const [setor] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "automobilismo-e-pilotagem"));
    expect(setor, "o setor do ramo devia ter nascido").toBeTruthy();
    expect(setor.nome).toBe("Automobilismo e pilotagem");
    expect(setor.ativo).toBe(true);
    const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, "e2e-ramo-salva"));
    expect(marca.nichoId).toBe(setor.id);
    expect(marca.ramoOutro).toBeNull();

    // O "Voltar" do bloco 1 leva ao passo dos dados, já com o ramo escolhido.
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(campoDoRamo(page)).toHaveValue("Automobilismo e pilotagem");
  });

  test("Conta: o ramo de hoje aparece, trocar mostra o que muda, salvar grava o setor novo, e recarregar mostra o ramo novo", async ({ page }) => {
    await entrar(page, EMAIL_CONTA);
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/conta");

    const campo = page.getByRole("combobox", { name: "ramo" });
    await expect(campo).toHaveValue("Odontologia");
    await expect(page.getByText("Ao trocar, os temas e as referências passam a ser os do ramo novo")).toHaveCount(0);

    await campo.fill("confeit");
    await expect(page.getByRole("option").first()).toContainText("Confeitaria e padaria");
    // Na Conta também há "Não achei o meu" (E45 PR 2, decisão 28); o `ramo-pedido.spec.ts` percorre o caminho dele.
    await expect(page.getByRole("option", { name: /Não achei o meu/ })).toBeVisible();
    await campo.press("Enter");

    await expect(page.getByText("Ao trocar, os temas e as referências passam a ser os do ramo novo")).toBeVisible();
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo")).toBeVisible();

    const [setor] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "confeitaria-e-padaria"));
    expect(setor).toBeTruthy();
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteContaId));
    expect(marca.nichoId).toBe(setor.id);

    // Sem recarregar: voltar ao ramo de antes e salvar de novo tem de gravar (a página não recarrega depois do salvar).
    await page.getByRole("combobox", { name: "ramo" }).fill("dentista");
    await page.getByRole("combobox", { name: "ramo" }).press("Enter");
    await expect(page.getByText("Ao trocar, os temas e as referências passam a ser os do ramo novo")).toBeVisible();
    await page.getByRole("button", { name: "salvar", exact: true }).click();
    await expect(page.getByText("salvo")).toBeVisible();
    const [dentistas] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
    await expect.poll(async () => (await db().select().from(clientes).where(eq(clientes.id, clienteContaId)))[0].nichoId).toBe(dentistas.id);

    await page.reload();
    await expect(page.getByRole("combobox", { name: "ramo" })).toHaveValue("Odontologia");
  });

  test("uma palavra que o catálogo não conhece não esvazia a lista, e o plural acha o ramo: 'salão de beleza', 'dentistas'", async ({ page }) => {
    await abrirPassoDoRamo(page, EMAIL_LEITURA);
    const campo = campoDoRamo(page);

    await campo.fill("salão de beleza");
    await expect(page.getByRole("option").first()).toContainText("Cabelo e barbearia");
    await campo.fill("dentistas");
    await expect(page.getByRole("option").first()).toContainText("Odontologia");
  });

  for (const [largura, altura] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    test(`com a lista aberta em ${largura}px: sem rolagem para o lado, campo de 44 pontos, e a lista não passa da largura da tela`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await abrirPassoDoRamo(page, EMAIL_LEITURA);
      const campo = campoDoRamo(page);
      await campo.fill("a");
      await expect(page.getByRole("listbox")).toBeVisible();

      const medidas = await page.evaluate(() => ({
        rolagemHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        larguraDaJanela: window.innerWidth,
      }));
      expect(medidas.rolagemHorizontal, "a lista aberta criou rolagem para o lado").toBe(false);

      const caixaDoCampo = await campo.boundingBox();
      expect(caixaDoCampo!.height).toBeGreaterThanOrEqual(44);
      const tamanhoDaFonte = await campo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      if (largura < 768) expect(tamanhoDaFonte, "abaixo de 16px o iOS dá zoom ao tocar").toBeGreaterThanOrEqual(16);

      const caixaDaLista = await page.getByRole("listbox").boundingBox();
      expect(caixaDaLista!.x).toBeGreaterThanOrEqual(0);
      expect(caixaDaLista!.x + caixaDaLista!.width).toBeLessThanOrEqual(largura + 1);

      // Cada opção é um alvo de toque de pelo menos 44 pontos de altura.
      const alturaDaPrimeira = (await page.getByRole("option").first().boundingBox())!.height;
      expect(alturaDaPrimeira).toBeGreaterThanOrEqual(44);
    });
  }
});
