/**
 * Fluxo do briefing pela tela (etapa 5, parte 2, criterio de aceite do plano
 * de execucao): cliente responde bloco a bloco, ve nota e analise, edita uma
 * resposta, ve a geral mudar, e liberado e cai em /hoje; recarregar no meio
 * traz o rascunho, as notas e o bloco em que parou. Depois, o briefing vivo
 * em /briefing: editar recalcula a geral e mostra o aviso quando a nota cai
 * abaixo da meta (gate de mao unica, revisao da parte 1).
 *
 * playwright.config.ts trava em um worker (workers: 1): mais de um arquivo
 * de e2e roda no mesmo processo Node e compartilha o pool do Postgres
 * (globalThis, src/db/index.ts). `resetarSchema` mais `semear` rodam uma
 * vez so, no `globalSetup` (etapa 11, ajuste 3 da revisao da etapa 10); este
 * arquivo so cria os proprios dados em cima do que o seed ja deixou.
 *
 * Este arquivo nunca chama `avaliarResposta` (ou qualquer funcao que passe
 * por `src/ia`) direto no corpo do teste: esse codigo roda no processo do
 * Playwright, no proprio Node, nao no navegador, entao nao herda o
 * `AI_PROVIDER=mock` que `webServer.env` (playwright.config.ts) so aplica ao
 * `npm run dev` que ele sobe. Achado do jeito caro: chamar a funcao direto
 * gastou chave de API de verdade num teste que devia custar zero. Sempre que
 * o teste precisar de um briefing ja avaliado, grava a linha direto no banco
 * (respostas, avaliacoes, notaGeral, completo, perfil) e deixa so a interacao
 * que o teste quer verificar de verdade passar pelo navegador.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, nichos, user, type AvaliacaoResposta } from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

const TITULO_LIBERACAO = "Seu painel está aberto.";

/**
 * Preenche a area de texto (pelo enunciado, um trecho basta) e clica em
 * avaliar. A nota geral so precisa chegar a 8,0 (briefing-e-rubricas.md,
 * secao 4); com respostas concretas isso pode acontecer antes da ultima
 * pergunta, e a tela de liberacao substitui o assistente inteiro nesse
 * instante. Por isso espera por dois estados possiveis (o campo fechar, ou a
 * liberacao aparecer) em vez de so um, e devolve se liberou.
 */
async function responderEAvaliar(page: Page, rotulo: string, texto: string): Promise<boolean> {
  await page.getByLabel(rotulo).fill(texto);
  // "avaliar" no wizard (/comecar), "avaliar de novo" no vivo (/briefing, editando).
  await page.getByRole("button", { name: /^avaliar/ }).first().click();
  const liberado = page.getByRole("heading", { name: TITULO_LIBERACAO });
  const campoFechado = page.getByLabel(rotulo);
  await Promise.race([
    liberado.waitFor({ state: "visible" }),
    campoFechado.waitFor({ state: "hidden" }),
  ]);
  return liberado.isVisible();
}

test.describe("briefing pela tela", () => {
  // Seed uma vez so, no globalSetup (etapa 11, ajuste 3); o pool do Postgres fecha uma vez
  // so, no globalTeardown (playwright.config.ts): mais de um arquivo de e2e roda no mesmo
  // worker e compartilha o pool.

  test("responde bloco a bloco, edita, ve a nota mudar, e liberado e cai em /hoje; recarregar traz o rascunho e o bloco certo", async ({
    page,
  }) => {
    // doze perguntas avaliadas mais navegacao entre blocos passam dos 30s padrao.
    test.setTimeout(90_000);

    await entrar(page, "seed-cliente-dentistas@exemplo.teste");
    await expect(page).toHaveURL(/\/comecar/);
    // o cliente do seed ja tem os dados fixos preenchidos: cai direto no
    // bloco 1, cujo H1 e o nome do bloco, nao mais o titulo da introducao
    // (achado da etapa D parte 2: o H1 repetia "Vamos montar o seu
    // briefing" em toda tela de bloco em vez do nome do bloco atual).
    await expect(page.getByRole("heading", { name: "Sobre o negócio" })).toBeVisible();
    await expect(page.getByText("bloco 1 de 5")).toBeVisible();

    await responderEAvaliar(
      page,
      "o que o seu negócio faz hoje",
      'Somos uma clinica odontologica em Sao Paulo que atende familias inteiras. Fazemos 42 procedimentos por semana, e uma cliente disse "finalmente perdi o medo de sorrir".',
    );
    await expect(page.getByText("MUITO BOA").first()).toBeVisible();

    // edita a P1: a nota muda, e o texto novo fica.
    await page.getByRole("button", { name: "ajustar resposta" }).first().click();
    await responderEAvaliar(page, "o que o seu negócio faz hoje", "atendimento bom");
    await expect(page.getByText("ABAIXO DO ESPERADO").first()).toBeVisible();

    // rascunho da P2 sem avaliar, para testar que sobrevive ao recarregar.
    await page.getByLabel("produto ou serviço que mais vende").fill("rascunho da P2, ainda sem avaliar");
    // espera o indicador "salvo" aparecer em vez de um tempo fixo (achado da
    // revisao da parte 1 de outra etapa: sob carga, o debounce de 800ms
    // podia nao ter gravado ainda quando o reload disparava, e o campo
    // voltava vazio).
    await expect(page.getByText("salvo")).toBeVisible();

    await page.reload();
    await expect(page.getByText("bloco 1 de 5")).toBeVisible();
    await expect(page.getByText("ABAIXO DO ESPERADO").first()).toBeVisible(); // a edicao da P1 sobreviveu
    await expect(page.getByLabel("produto ou serviço que mais vende")).toHaveValue(
      "rascunho da P2, ainda sem avaliar",
    );

    // devolve a P1 para uma resposta concreta, para nao atrapalhar a liberacao mais adiante.
    await page.getByRole("button", { name: "ajustar resposta" }).first().click();
    await responderEAvaliar(
      page,
      "o que o seu negócio faz hoje",
      'Somos uma clinica odontologica em Sao Paulo que atende familias inteiras. Fazemos 42 procedimentos por semana, e uma cliente disse "finalmente perdi o medo de sorrir".',
    );

    // As perguntas restantes, em ordem, com o marcador de bloco entre elas. A
    // nota geral so precisa chegar a 8,0 (secao 4 da rubrica); com respostas
    // concretas isso pode acontecer antes da ultima pergunta, entao o loop
    // abaixo para assim que a liberacao aparecer, em vez de sempre preencher
    // as doze.
    const passos: ({ rotulo: string; texto: string } | { bloco: number })[] = [
      {
        rotulo: "produto ou serviço que mais vende",
        texto:
          'O que mais vende e a limpeza dental completa, 250 reais na Clinica Sorriso Novo, e a Ana Paula disse "finalmente parei de sentir vergonha de sorrir".',
      },
      {
        rotulo: "faz diferente de quem oferece",
        texto:
          "A diferenca e que eu mesma atendo do inicio ao fim. Um paciente, o Carlos, trocou de 3 clinicas antes e so terminou o tratamento aqui.",
      },
      { bloco: 2 },
      {
        rotulo: "cliente que você mais gosta",
        texto:
          'Atendo a Marina, 34 anos, mora no Brooklin, e me procura quando esta com dor ha 3 dias, dizendo "nao aguento mais esperar".',
      },
      {
        rotulo: "dúvida, o medo ou a desculpa",
        texto:
          'O medo dela e sentir dor, como ela diz: "tenho pavor de agulha". Isso trava a decisao em 8 de cada 10 casos na Clinica Sorriso Novo.',
      },
      {
        rotulo: "perguntas seus clientes mais repetem",
        texto:
          "As 5 mais comuns: 1) doi muito, 2) quanto custa, 3) quantas sessoes, 4) parcela em 12x, 5) tem anestesia, no balcao da Clinica Sorriso Novo.",
      },
      { bloco: 3 },
      {
        rotulo: "o que você quer que aconteça",
        texto:
          "Quero que a Marina agende uma avaliacao gratuita pelo WhatsApp, e como segunda opcao que indique 1 amigo que precise de dentista.",
      },
      {
        rotulo: "Onde você posta hoje",
        texto:
          'Postamos no Instagram 3 vezes por semana ha 6 meses. O video "antes e depois" trouxe 12 agendamentos na mesma semana.',
      },
      { bloco: 4 },
      {
        rotulo: "Como você fala com o cliente",
        texto:
          'Eu falo "vamos cuidar de voce com calma, sem dor" pelo menos 3 vezes por dia na Clinica Sorriso Novo, e tambem "pode confiar, eu mesma acompanho cada passo".',
      },
      {
        rotulo: "nunca diria ou faria",
        texto:
          "Nunca prometo resultado em 1 dia, nunca uso a palavra milagroso, e nunca mostro paciente sem autorizacao, mesmo que a Ana Paula ficasse otima na cena.",
      },
      { bloco: 5 },
      {
        rotulo: "câmera pode mostrar",
        texto:
          'A camera pode mostrar a recepcao, a sala de raio-x, os 3 equipamentos novos da Clinica Sorriso Novo, dizendo "que resultado incrivel", e a equipe toda de jaleco.',
      },
      {
        rotulo: "perfis que você admira",
        texto:
          "Admiro @sorrisodouradooficial pela didatica. Concorrente direto e a Clinica Vida Nova, que fica a 2 quarteiroes, e o Espaco Sorriso Feliz.",
      },
    ];

    let liberado = false;
    for (const passo of passos) {
      if (liberado) break;
      if ("bloco" in passo) {
        await page.getByRole("button", { name: "próximo bloco" }).click();
        await expect(page.getByText(`bloco ${passo.bloco} de 5`)).toBeVisible();
      } else {
        liberado = await responderEAvaliar(page, passo.rotulo, passo.texto);
      }
    }

    await expect(page.getByRole("heading", { name: TITULO_LIBERACAO })).toBeVisible();
    await page.getByRole("button", { name: "ver o tema de hoje" }).click();
    await expect(page).toHaveURL(/\/hoje/);
  });

  test("no briefing vivo, editar recalcula a nota e mostra o aviso quando a nota cai abaixo da meta", async ({
    page,
  }) => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    await db().insert(user).values({
      id: "e2e-briefing-vivo",
      name: "[teste] Briefing Vivo",
      email: "e2e-briefing-vivo@exemplo.teste",
    });
    await db()
      .insert(account)
      .values({
        id: "e2e-briefing-vivo-credential",
        issuer: "local:credential",
        accountId: "e2e-briefing-vivo",
        providerId: "credential",
        userId: "e2e-briefing-vivo",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-briefing-vivo", nome: "[teste] Briefing Vivo", nichoId: nicho.id })
      .returning();

    const avaliacaoNota9 = (id: string): AvaliacaoResposta => ({
      nota: 9,
      bom: `A resposta de ${id} tem exemplo concreto.`,
      melhorar: "Poderia trazer mais um numero ou exemplo.",
      como: "Escreva como se fosse para alguem que nunca ouviu falar do seu ramo, com um caso real.",
      impacto: "Uma resposta mais concreta gera um roteiro mais parecido com voce.",
    });
    const respostas: Record<string, string> = {};
    const avaliacoes: Record<string, AvaliacaoResposta> = {};
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]) {
      respostas[id] = `Resposta concreta para ${id}, com o numero 42 na frase, a fala real "isso resolveu o meu problema", e o bairro de Pinheiros.`;
      avaliacoes[id] = avaliacaoNota9(id);
    }

    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        respostas,
        avaliacoes,
        notaGeral: "9.00",
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "limpeza dental completa",
            preco: "250 reais",
            clienteIdeal: "familias que buscam atendimento continuo",
            medos: ["medo de sentir dor durante o procedimento"],
            frasesDaFala: ['"vamos cuidar de voce com calma, sem dor"'],
            proibicoes: [],
            cenasFilmaveis: ["recepcao", "sala de raio-x"],
            concorrentes: ["Clinica Vida Nova"],
            perfisAdmirados: ["@sorrisodouradooficial"],
          },
          resumo: "Clinica odontologica que atende familias inteiras em Sao Paulo.",
          referencias: [],
        },
      });

    await entrar(page, "e2e-briefing-vivo@exemplo.teste");
    await expect(page).toHaveURL(/\/hoje/);

    await page.goto("/briefing");
    await expect(page.getByRole("heading", { name: "O seu briefing" })).toBeVisible();
    await expect(page.getByText("como o sistema te entende")).toBeVisible();

    await page.getByRole("button", { name: "editar" }).first().click();
    const primeiraPergunta = "Em poucas palavras, o que o seu negócio faz hoje";
    await responderEAvaliar(page, primeiraPergunta, "atendimento bom");

    // BarraNotaGeral renderiza a mesma dica duas vezes (folha do celular +
    // aside do desktop, so o CSS decide qual aparece); .last() pega a do
    // desktop, que e o viewport padrao do Playwright aqui.
    await expect(page.getByText(/a sua nota caiu para/).last()).toBeVisible();
    await expect(page.getByText(/reforçar a p1/i).last()).toBeVisible();

    // o gate e de mao unica: o painel continua acessivel mesmo com a nota abaixo da meta.
    await page.reload();
    await expect(page.getByRole("heading", { name: "O seu briefing" })).toBeVisible();
    await expect(page.getByText(/a sua nota caiu para/).last()).toBeVisible();
  });
});
