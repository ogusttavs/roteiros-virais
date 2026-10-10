/**
 * `/criar/tema-livre` pela tela, os cinco estados do design v2
 * (`entregaveis/design-v2/entrega/telas/TemaLivre.dc.html`; `PROXIMO.md`,
 * V5b): proposta, esperando, naMeta, abaixoDaMeta e erro. Mais o item 7 da
 * etapa, o rascunho escopado pela marca ativa (V3): escrever na Marca Um,
 * trocar para a Dois mostra campo vazio, voltar para a Um traz o texto de
 * volta.
 *
 * Este arquivo nunca chama `avaliarTema` nem qualquer função de `src/ia`
 * direto no corpo do teste (mesma lição de `briefing.spec.ts` e
 * `temas-do-dia.spec.ts`): grava briefing e vídeos direto no banco, e deixa
 * só a avaliação passar pelo navegador, contra o `AI_PROVIDER=mock` do
 * servidor. O estado `naMeta` usa `MARCADOR_NOTA_ALTA` (`src/ia/mock.ts`):
 * sem ele, a média do mock nunca passa de 6,6, mesmo com evidência forte.
 *
 * Roteiro próprio ("e2e-tema-livre"), sem `resetarSchema` (mesma lição de
 * `roteiro.spec.ts` e `layout.spec.ts`): o seed roda uma vez só, no
 * globalSetup.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  contas,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  rascunhosTemaLivre,
  user,
  videos,
} from "../../src/db/schema";
import { textosNav } from "../../src/textos/nav";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-tema-livre@exemplo.teste";
const NOME_MARCA_UM = "[teste] Tema Livre Um";
const NOME_MARCA_DOIS = "[teste] Tema Livre Dois";
const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const CAMPO = "Sobre o que você quer falar?";

/**
 * O estado de partida de cada teste (e de cada tentativa: o Playwright repete na CI, e o banco não volta ao que era). Os testes pressupõem que a marca que abre ao
 * entrar, sem cookie ainda, é a Um. Mas `marcaPadrao` (`servicos/clientes.ts`) escolhe a de acesso mais recente, e só depois a criada por último; e o acesso é gravado
 * uma vez por dia por marca. Duas coisas derrubavam `:206` e `:294` só na CI (PR #145, 09/10: 25 minutos de CI cada vez): (1) as duas marcas criadas no mesmo
 * milissegundo empatam em `criadoEm`, e o empate cai na ordem do nome, "Dois" antes de "Um"; (2) o teste das marcas visita a Dois, que passa a ser a de acesso mais
 * recente para qualquer tentativa seguinte. Aqui a Um é a de acesso mais recente e a Dois nunca foi acessada, sempre; e os rascunhos de um teste não vazam para o outro.
 */
async function restaurarEstadoDeSaida() {
  const marcas = await db().select({ id: clientes.id, nome: clientes.nome }).from(clientes).where(eq(clientes.usuarioId, "e2e-tema-livre"));
  for (const marca of marcas) {
    await db()
      .update(clientes)
      .set({ ultimoAcessoEm: marca.nome === NOME_MARCA_UM ? new Date() : null })
      .where(eq(clientes.id, marca.id));
  }
  await db().delete(rascunhosTemaLivre).where(eq(rascunhosTemaLivre.usuarioId, "e2e-tema-livre"));
}

/** Abre o Tema livre e espera a tela assentar antes de digitar (a mesma precaução de `agenda.spec.ts`: digitar e clicar logo depois do `goto` é o que oscila sob carga). */
async function abrirTemaLivre(page: Page) {
  await page.goto("/criar/tema-livre");
  await expect(page.getByLabel(CAMPO)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** O Hoje assentado antes de abrir a folha das marcas (a mesma precaução de `abrirTemaLivre`). */
async function abrirHoje(page: Page) {
  await page.goto("/hoje");
  await page.waitForLoadState("networkidle");
}

/** A resposta da ação que grava o rascunho (um POST para a própria página): esperar por ela vale mais que um tempo fixo, que na CI pode não bastar. */
function esperarRascunhoGravado(page: Page) {
  return page.waitForResponse(
    (resposta) => resposta.request().method() === "POST" && new URL(resposta.url()).pathname === "/criar/tema-livre",
  );
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

test.describe("tema livre pela tela, os cinco estados", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-tema-livre"));
    if (jaExiste) return;

    const [nichoUm] = await db()
      .insert(nichos)
      .values({ slug: "e2e-tema-livre-um", nome: "[teste] Tema Livre Um" })
      .returning();
    const [nichoDois] = await db()
      .insert(nichos)
      .values({ slug: "e2e-tema-livre-dois", nome: "[teste] Tema Livre Dois" })
      .returning();

    await db().insert(user).values({ id: "e2e-tema-livre", name: "[teste] Tema Livre", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-tema-livre-credential",
        issuer: "local:credential",
        accountId: "e2e-tema-livre",
        providerId: "credential",
        userId: "e2e-tema-livre",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-tema-livre", aceitouTermosEm: new Date() });

    // Os testes abaixo pressupoem que a marca ativa no primeiro login (sem cookie ainda) e a Um, que tem os videos de prova.
    // Quem garante isso e o `beforeEach` (`restaurarEstadoDeSaida`); a ordem de criacao aqui nao basta, pode empatar no milissegundo.
    const [marcaDois] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-tema-livre", nome: NOME_MARCA_DOIS, nichoId: nichoDois.id })
      .returning();
    const [marcaUm] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-tema-livre", nome: NOME_MARCA_UM, nichoId: nichoUm.id })
      .returning();
    await db()
      .insert(membrosMarca)
      .values([
        { usuarioId: "e2e-tema-livre", clienteId: marcaUm.id, papel: "dono" },
        { usuarioId: "e2e-tema-livre", clienteId: marcaDois.id, papel: "dono" },
      ]);
    await db()
      .insert(briefings)
      .values([
        { clienteId: marcaUm.id, ...briefingCompletoExemplo() },
        { clienteId: marcaDois.id, ...briefingCompletoExemplo() },
      ]);

    // Prova suficiente (V2b, item 8) para o angulo sugerido aparecer: 3 videos, 2 contas, recentes, br.
    const titulo = "como tirar mancha de sofa de camurca sem estragar o tecido";
    const [contaA] = await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: "@e2e-tema-livre-a", nichoId: nichoUm.id, medianaViews: "1000" })
      .returning();
    const [contaB] = await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: "@e2e-tema-livre-b", nichoId: nichoUm.id, medianaViews: "1000" })
      .returning();
    const analise = {
      assunto: "mancha em sofa de camurca",
      gancho: "esse produto tira qualquer mancha do sofa",
      estrutura: "mostra o antes e o depois",
      fechamento: "resumo do que foi mostrado",
      chamadaFinal: "comenta se voce ja passou por isso",
      formato: "fala_para_camera",
      porQueFuncionou: "mostra o produto agindo direto na mancha, sem cortar",
    };
    await db()
      .insert(videos)
      .values([
        {
          plataforma: "youtube",
          idExterno: "e2e-tema-livre-prova-1",
          url: "https://exemplo.invalido/e2e-tema-livre-prova-1",
          nichoId: nichoUm.id,
          contaId: contaA.id,
          titulo,
          foraDaCurva: "4.1",
          publicadoEm: new Date(),
          idioma: "pt",
          analise: analise as never,
        },
        {
          plataforma: "youtube",
          idExterno: "e2e-tema-livre-prova-2",
          url: "https://exemplo.invalido/e2e-tema-livre-prova-2",
          nichoId: nichoUm.id,
          contaId: contaB.id,
          titulo,
          foraDaCurva: "4.1",
          publicadoEm: new Date(),
          idioma: "pt",
          analise: analise as never,
        },
        {
          plataforma: "youtube",
          idExterno: "e2e-tema-livre-prova-3",
          url: "https://exemplo.invalido/e2e-tema-livre-prova-3",
          nichoId: nichoUm.id,
          contaId: contaA.id,
          titulo,
          foraDaCurva: "4.1",
          publicadoEm: new Date(),
          idioma: "pt",
          analise: analise as never,
        },
      ]);
  });

  test.beforeEach(restaurarEstadoDeSaida);

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("proposta: campo vazio reprova antes de avaliar", async ({ page }) => {
    await entrar(page);
    await abrirTemaLivre(page);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByText("escreva um assunto antes de avaliar")).toBeVisible();
  });

  test("sem evidencia no banco: cai em 'dá para melhorar' sem o cartão de ângulo", async ({ page }) => {
    await entrar(page);
    await abrirTemaLivre(page);
    await page.getByLabel("Sobre o que você quer falar?").fill("um assunto qualquer sem nenhuma evidencia no banco");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByRole("heading", { name: "Dá para melhorar esse tema" })).toBeVisible();
    await expect(page.getByText("Editar o texto")).toBeVisible();
    await expect(page.getByRole("button", { name: "Seguir com o meu mesmo assim" })).toBeVisible();
    await expect(page.getByText("O ângulo mais próximo que tem evidência")).not.toBeVisible();
  });

  test("com prova suficiente: o cartão do ângulo sugerido aparece com os dois caminhos", async ({ page }) => {
    await entrar(page);
    await abrirTemaLivre(page);
    await page
      .getByLabel("Sobre o que você quer falar?")
      .fill("como tirar mancha de sofa de camurca sem estragar o tecido");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByText("O ângulo mais próximo que tem evidência")).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar o ângulo sugerido" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Seguir com o meu mesmo assim" })).toBeVisible();
  });

  test("editar o texto volta para a proposta com o texto preservado", async ({ page }) => {
    await entrar(page);
    await abrirTemaLivre(page);
    await page.getByLabel("Sobre o que você quer falar?").fill("um assunto para editar depois");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByText("Editar o texto")).toBeVisible();

    await page.getByRole("button", { name: "Editar o texto" }).click();
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?" })).toBeVisible();
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue("um assunto para editar depois");
  });

  test("nota na meta: mostra 'pode gravar esse' e o botão único de escrever o roteiro", async ({ page }) => {
    await entrar(page);
    await abrirTemaLivre(page);
    await page.getByLabel("Sobre o que você quer falar?").fill(MARCADOR_NOTA_ALTA);
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByRole("heading", { name: "Pode gravar esse" })).toBeVisible();
    await expect(page.getByText("Na meta")).toBeVisible();
    const botaoEscrever = page.getByRole("button", { name: "Escrever o roteiro" });
    await expect(botaoEscrever).toBeVisible();

    await botaoEscrever.click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?livre=/);
  });

  test("erro na avaliação: mostra o aviso, o texto continua guardado, e tentar de novo funciona", async ({ page }) => {
    await entrar(page);
    await abrirTemaLivre(page);

    await page.route("**/criar/tema-livre", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 500, body: "erro simulado" });
        return;
      }
      await route.continue();
    });

    await page.getByLabel("Sobre o que você quer falar?").fill("um assunto que vai falhar");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByText("Não deu para avaliar o tema")).toBeVisible();
    await expect(page.getByText("um assunto que vai falhar")).toBeVisible();

    await page.unrouteAll();
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByText("Editar o texto")).toBeVisible();
  });

  test("avaliar com sucesso mantém o rascunho: sai para o Hoje, volta, o texto continua no campo", async ({ page }) => {
    // Item 0 da V6 (resto da revisão do PR #50): antes o rascunho era apagado ao avaliar; na
    // viagem, com rede ruim, quem recebe uma nota abaixo da meta, sai e volta, precisa achar o
    // texto lá.
    await entrar(page);
    await abrirTemaLivre(page);
    // Espera o servidor gravar o rascunho (o debounce de 800ms mais a resposta) antes de avaliar: sem isto, o clique
    // acontece rápido demais (o mock responde antes do debounce disparar) e o `page.goto`
    // seguinte, um reload completo, cancela o timer pendente antes dele salvar nada (achado
    // escrevendo este teste; não reflete o uso real, onde a chamada de verdade demora mais que
    // 800ms). Esperar a resposta, e não um tempo fixo, é o que não depende da velocidade da CI.
    const gravou = esperarRascunhoGravado(page);
    await page
      .getByLabel(CAMPO)
      .fill("assunto avaliado que precisa sobreviver a sair e voltar");
    await gravou;
    await page.getByRole("button", { name: "Avaliar o tema" }).click();
    await expect(page.getByText("Editar o texto")).toBeVisible();

    await page.goto("/hoje");
    await abrirTemaLivre(page);
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue(
      "assunto avaliado que precisa sobreviver a sair e voltar",
    );
  });

  test("o rascunho é da marca ativa: escreve numa marca, troca para a outra (campo vazio), volta (texto de volta)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);

    // A marca ativa no primeiro login e a de criacao mais recente (marcaPadrao, sem cookie
    // ainda): Marca Um, criada depois da Dois neste fixture. Confirma antes de assumir.
    await abrirHoje(page);
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) })).toBeVisible();

    await abrirTemaLivre(page);
    const gravou = esperarRascunhoGravado(page);
    await page.getByLabel(CAMPO).fill("rascunho exclusivo da marca ativa");
    await gravou; // o debounce de 800ms mais a resposta do salvamento do rascunho

    await abrirHoje(page);
    const pilula = page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) });
    await pilula.click();
    const folha = page.getByRole("dialog", { name: textosNav.suasMarcas });
    await expect(folha).toBeVisible();
    await folha.getByRole("button", { name: NOME_MARCA_DOIS }).click();
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) })).toBeVisible();
    // Espera a rede assentar antes de recarregar: o nome do botao muda otimista, antes da
    // troca (e a gravacao do cookie) terminar no servidor, e duas trocas em sequencia no mesmo
    // teste sao sensiveis ao timing exato da revalidacao (achado escrevendo este teste).
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) })).toBeVisible();

    await abrirTemaLivre(page);
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue("");

    // /criar/tema-livre tem a propria BarraTopo, sem o seletor de marca: volta para /hoje antes.
    await abrirHoje(page);
    await page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) }).click();
    const folhaDeVolta = page.getByRole("dialog", { name: textosNav.suasMarcas });
    await expect(folhaDeVolta).toBeVisible();
    await folhaDeVolta.getByRole("button", { name: NOME_MARCA_UM }).click();
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) })).toBeVisible();

    await abrirTemaLivre(page);
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue("rascunho exclusivo da marca ativa");
  });
});
