/**
 * O exportador do design v2 virou teste e2e de layout (design v2,
 * `entrega/telas/README.md`; `PROXIMO.md`, D2 parte 1, item 8): para Hoje,
 * Roteiro e Gravação, nas larguras 390, 1024 e 1280, nenhuma tela pode
 * estourar na horizontal, e nenhum alvo de toque pode ficar abaixo de
 * 44 px. Roteiro próprio ("e2e-layout"), sem `resetarSchema` (mesma lição
 * de `roteiro.spec.ts`): o seed roda uma vez só, no globalSetup.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  contas,
  nichos,
  roteiros,
  temasDia,
  user,
  videos,
  type AvaliacaoResposta,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-layout@exemplo.teste";
const EMAIL_COMECAR = "e2e-layout-comecar@exemplo.teste";
const EMAIL_BRIEFING = "e2e-layout-briefing@exemplo.teste";
const LARGURAS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1024", largura: 1024, altura: 768 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
/** A folha (BarraNotaGeral) so existe abaixo de 1180px; acima disso vira cartao lateral fixo. */
const LARGURAS_COM_FOLHA = LARGURAS.filter((l) => l.largura < 1180);
const ALTURA_TOQUE_MINIMA = 44;

let roteiroId: number;

function avaliacaoExemplo(nota: number): AvaliacaoResposta {
  return {
    nota,
    bom: "Resposta com exemplo concreto.",
    melhorar: "Falta um numero ou um caso real.",
    como: "Escreva como se fosse para alguem que nunca ouviu falar do seu ramo.",
    impacto: "Uma resposta mais concreta gera um roteiro mais parecido com voce.",
  };
}

async function entrarComo(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  // Espera o login terminar antes de navegar de novo: sem isto, um `page.goto`
  // logo em seguida corre o risco de abortar o POST de login ainda em voo
  // (achado rodando esta suite: a terceira largura perdia a corrida).
  await expect(page).toHaveURL(/\/hoje/);
}

/** Nenhuma rolagem horizontal e nenhum alvo de toque abaixo de 44 px, na largura atual. */
async function conferirLayout(page: Page) {
  const semRolagemHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(semRolagemHorizontal, "a tela nao pode rolar na horizontal").toBe(true);

  const alvosPequenos = await page.evaluate((minimo) => {
    const elementos = document.querySelectorAll('button, a[href], input, [role="button"]');
    const pequenos: string[] = [];
    elementos.forEach((el) => {
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.width < minimo || r.height < minimo) {
        pequenos.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    });
    return pequenos;
  }, ALTURA_TOQUE_MINIMA);

  expect(alvosPequenos, "alvo de toque abaixo de 44px").toEqual([]);
}

test.describe("layout: Hoje, Roteiro e Gravação em 390, 1024 e 1280", () => {
  test.beforeAll(async () => {
    // Nicho proprio, nao um dos dois do seed: roteiro.spec.ts ja usa
    // "limpeza-e-organizacao-da-casa" e temas-do-dia.spec.ts ja usa
    // "dentistas" para a linha de hoje de temas_dia (uma por nicho por dia,
    // `temas_dia_nicho_data`; achado rodando esta suite: as duas colidiam
    // com este arquivo).
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-layout", nome: "[teste] Layout" })
      .returning();

    await db().insert(user).values({ id: "e2e-layout", name: "[teste] Layout", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-layout-credential",
        issuer: "local:credential",
        accountId: "e2e-layout",
        providerId: "credential",
        userId: "e2e-layout",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-layout", nome: "[teste] Layout", nichoId: nicho.id, aceitouTermosEm: new Date() })
      .returning();

    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
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
      });

    const [conta] = await db()
      .insert(contas)
      .values({
        plataforma: "youtube",
        handle: "UC_e2e_layout",
        nome: "@exemplo_limpeza_layout",
        nichoId: nicho.id,
        medianaViews: "1000",
      })
      .returning();

    const [video] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-layout-mancha",
        url: "https://exemplo.invalido/e2e-layout-mancha",
        nichoId: nicho.id,
        contaId: conta.id,
        titulo: "o produto que tira qualquer mancha do estofado",
        views: 5200,
        foraDaCurva: "4.1",
        publicadoEm: new Date(),
        analise: {
          assunto: "mancha em estofado",
          gancho: "esse produto tira qualquer mancha do estofado",
          estrutura: "mostra o produto agindo na mancha antes de explicar",
          fechamento: "resumo do que foi mostrado",
          chamadaFinal: "comenta se voce ja passou por isso",
          formato: "fala_para_camera",
          porQueFuncionou: "mostrar o problema antes de explicar",
        } as never,
      })
      .returning();

    const temas: TemaDoDia[] = [
      {
        titulo: "o erro que faz a mancha voltar depois da limpeza",
        descricao: "descricao do tema",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [video.id],
        puxaPara: "conversao",
      },
      {
        titulo: "tema de teste 2, layout",
        descricao: "descricao do tema 2",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "engajamento",
      },
      {
        titulo: "tema de teste 3, layout",
        descricao: "descricao do tema 3",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "alcance",
      },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });

    const conteudo: ConteudoRoteiro = {
      titulo: "o erro que faz a mancha voltar depois da limpeza",
      duracaoS: 40,
      gancho: "se a mancha volta dois dias depois, o problema nao e o produto",
      corpo: "explique a ordem certa enquanto faz. aplicar, esperar o tempo, e so entao esfregar.",
      fechamento: "mostre a peca limpa",
      chamadaFinal: "manda uma mensagem que eu te digo qual produto usar",
      cenas: [{ momento: "abertura", oQueFazer: "mostrar a mancha" }],
      ondeGravar: "na sala, perto do sofa",
      edicao: {
        textoNaTela: [],
        ritmoDeCorte: "moderado",
        recursos: [],
        audio: null,
        referencia: { videoId: video.id, segundo: 4, oQueOlhar: "o antes e depois" },
      },
      evidencias: [video.id],
      semEvidencia: false,
    };

    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: hojeISO(),
        tema: conteudo.titulo,
        origem: "sugerido",
        objetivo: "conversao",
        conteudo,
        referenciaVideoId: video.id,
      })
      .returning();
    roteiroId = roteiro.id;

    /**
     * Cliente proprio para Comecar (estados "perguntas" e "folha", item 5 do
     * PROXIMO.md): dados fixos preenchidos (cai direto no bloco 1) e o
     * bloco 1 com uma nota em cada faixa (na meta, neutra, baixa), para a
     * folha das doze notas ter conteudo de verdade, nao so "sem nota".
     */
    await db().insert(user).values({ id: "e2e-layout-comecar", name: "[teste] Layout Comecar", email: EMAIL_COMECAR });
    await db()
      .insert(account)
      .values({
        id: "e2e-layout-comecar-credential",
        issuer: "local:credential",
        accountId: "e2e-layout-comecar",
        providerId: "credential",
        userId: "e2e-layout-comecar",
        password: await hashPassword(SENHA),
      });
    const [clienteComecar] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-layout-comecar",
        nome: "[teste] Layout Comecar",
        cidade: "Sao Paulo",
        nichoId: nicho.id,
      })
      .returning();
    await db()
      .insert(briefings)
      .values({
        clienteId: clienteComecar.id,
        /**
         * P3 fica sem avaliacao de proposito: `blocoInicial` (briefing-regras.ts)
         * so avanca de bloco quando NENHUMA pergunta do bloco atual esta
         * pendente, entao com as tres respondidas o teste cairia direto no
         * bloco 2. Duas fechadas (na meta e neutra) mais uma aberta cobre os
         * dois estados do cartao na mesma tela.
         */
        respostas: {
          p1: "Somos uma clinica de estetica que atende mulheres de 30 a 50 anos, com procedimentos faciais.",
          p2: "O produto que mais vende e o peeling facial.",
        },
        avaliacoes: { p1: avaliacaoExemplo(8.6), p2: avaliacaoExemplo(7.1) },
        notaGeral: "6.83",
        completo: false,
      });

    /**
     * Cliente proprio para Briefing (item 5 do PROXIMO.md): briefing completo
     * com respostas e avaliacoes de verdade, para as linhas ".resposta"
     * (Briefing.dc.html) terem texto e nota para medir.
     */
    await db().insert(user).values({ id: "e2e-layout-briefing", name: "[teste] Layout Briefing", email: EMAIL_BRIEFING });
    await db()
      .insert(account)
      .values({
        id: "e2e-layout-briefing-credential",
        issuer: "local:credential",
        accountId: "e2e-layout-briefing",
        providerId: "credential",
        userId: "e2e-layout-briefing",
        password: await hashPassword(SENHA),
      });
    const [clienteBriefing] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-layout-briefing",
        nome: "[teste] Layout Briefing",
        nichoId: nicho.id,
        aceitouTermosEm: new Date(),
      })
      .returning();
    const respostasBriefing: Record<string, string> = {};
    const avaliacoesBriefing: Record<string, AvaliacaoResposta> = {};
    for (let i = 1; i <= 12; i++) {
      const id = `p${i}`;
      respostasBriefing[id] = `Resposta concreta para ${id}, com o numero 42 na frase e o bairro de Pinheiros.`;
      avaliacoesBriefing[id] = avaliacaoExemplo(i === 3 ? 4.8 : i === 2 ? 7.1 : 8.6);
    }
    await db()
      .insert(briefings)
      .values({
        clienteId: clienteBriefing.id,
        respostas: respostasBriefing,
        avaliacoes: avaliacoesBriefing,
        notaGeral: "8.20",
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "kit tira-mancha para estofados",
            preco: "kit a partir de 89 reais",
            clienteIdeal: "mora em apartamento",
            medos: ["medo de estragar o tecido"],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: ["sala com o sofa"],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "marca propria de produtos de limpeza",
          referencias: [],
        },
      });
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  for (const { rotulo, largura, altura } of LARGURAS) {
    test(`Hoje em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await expect(page).toHaveURL(/\/hoje/);
      await expect(page.getByRole("heading", { name: "O que gravar hoje" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Roteiro em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto(`/roteiros/${roteiroId}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await conferirLayout(page);
    });

    /** E27, parte 1, definição de pronto: a folha "reprovar" (chips, campo livre) não pode estourar nem trazer alvo pequeno em nenhuma largura. */
    test(`Roteiro, folha reprovar aberta, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto(`/roteiros/${roteiroId}`);
      await page.getByRole("button", { name: "Mais opções" }).click();
      await page.getByRole("menuitem", { name: "Reprovar" }).click();
      await expect(page.getByRole("dialog", { name: "O que não ficou bom?" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Gravação em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto(`/roteiros/${roteiroId}/gravar`);
      await expect(page.getByText("1 de 4")).toBeVisible();
      await conferirLayout(page);
    });

    test(`Começar, estado perguntas, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarComo(page, EMAIL_COMECAR);
      await expect(page).toHaveURL(/\/comecar/);
      await expect(page.getByRole("heading", { name: "Sobre o negócio" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Briefing em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarComo(page, EMAIL_BRIEFING);
      // Espera o login terminar (mesmo achado de `entrar`, acima) antes do goto seguinte.
      await expect(page).toHaveURL(/\/hoje/);
      await page.goto("/briefing");
      await expect(page.getByRole("heading", { name: "O seu briefing" })).toBeVisible();
      await conferirLayout(page);
    });
  }

  for (const { rotulo, largura, altura } of LARGURAS_COM_FOLHA) {
    test(`Começar, estado folha, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarComo(page, EMAIL_COMECAR);
      await expect(page).toHaveURL(/\/comecar/);
      await page.getByRole("button", { name: "as doze notas" }).click();
      await expect(page.getByRole("dialog", { name: "as doze notas" })).toBeVisible();
      await conferirLayout(page);
    });
  }
});
