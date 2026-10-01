/**
 * O exportador do design v2 virou teste e2e de layout (design v2,
 * `entrega/telas/README.md`; `PROXIMO.md`, D2 parte 1, item 8): para Hoje,
 * Roteiro e Gravação, nas larguras 390, 1024 e 1280, nenhuma tela pode
 * estourar na horizontal, e nenhum alvo de toque pode ficar abaixo de
 * 44 px. Roteiro próprio ("e2e-layout"), sem `resetarSchema` (mesma lição
 * de `roteiro.spec.ts`): o seed roda uma vez só, no globalSetup.
 *
 * V7, item 1 e 3: a 360 x 740 (Android pequeno) entrou ao lado da 390 em
 * toda tela já coberta, e o caminho da viagem ganhou as cinco telas que
 * faltavam (Entrar, Tema livre, Objetivo, Histórico, Conta). O botão
 * principal continuar dentro da área visível com a viewport reduzida a
 * 390 x 500 (simula o teclado tirando altura) é um bloco à parte, no fim
 * do arquivo, só nas telas que têm um botão principal claro.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  aprendizadoCliente,
  briefings,
  clientes,
  contas,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  temasDia,
  user,
  videos,
  type AvaliacaoResposta,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { textosConexao } from "../../src/textos/conexao";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-layout@exemplo.teste";
const EMAIL_COMECAR = "e2e-layout-comecar@exemplo.teste";
const EMAIL_BRIEFING = "e2e-layout-briefing@exemplo.teste";
const EMAIL_MARCAS = "e2e-layout-marcas@exemplo.teste";
const LARGURAS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "360", largura: 360, altura: 740 },
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

/**
 * Nenhuma rolagem horizontal e nenhum alvo de toque abaixo de 44 px, na largura atual.
 *
 * Achado investigando por que a CI reprovou os chips de rede de `ListaPerfisCitados` (29 px) no
 * PR #85 e o mesmo teste passou local, duas vezes (duas pessoas): `BlocoPerfisCitados` busca a
 * lista de perfis citados numa Server Action, dentro de um `useEffect`, e devolve `null` até ela
 * chegar. Sem esperar isso, `conferirLayout` mede a tela ANTES de esses chips existirem no DOM, e
 * uma corrida vazia nunca acusa alvo pequeno (a lista de achados fica vazia por não ter achado
 * nada, não por estar tudo certo). Reproduzido: com `waitForLoadState("networkidle")antes, o
 * mesmo teste reprova com os mesmos 29 px que a CI relatou; sem a espera, zero chips medidos. A
 * diferença não era local vs CI (fonte, SO, dado do seed): era essa corrida, que calha de ter mais
 * chance de perder (os chips não chegam a tempo) numa maquina rapida que builda e sobe o servidor
 * de producao local, e mais chance de ganhar numa CI mais lenta. `networkidle` aqui, uma vez só,
 * cobre qualquer tela com busca assíncrona parecida, não só esta.
 */
async function conferirLayout(page: Page) {
  await page.waitForLoadState("networkidle");

  const semRolagemHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(semRolagemHorizontal, "a tela nao pode rolar na horizontal").toBe(true);

  const alvosPequenos = await page.evaluate((minimo) => {
    const elementos = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]');
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

  // V7, item 2: o iPhone da zoom sozinho ao focar um campo com fonte abaixo de 16 px (o zoom nao volta
  // sem pinca). So vale abaixo do tablet, onde o teclado do celular aparece.
  if ((page.viewportSize()?.width ?? 0) < 768) {
    const camposPequenos = await page.evaluate(() => {
      const achados: string[] = [];
      document.querySelectorAll("input, select, textarea").forEach((el) => {
        const campo = el as HTMLInputElement;
        if (["checkbox", "radio", "hidden", "range", "file", "submit", "button"].includes(campo.type)) return;
        const estilo = getComputedStyle(el);
        if (estilo.display === "none" || estilo.visibility === "hidden") return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (parseFloat(estilo.fontSize) < 16) {
          achados.push(`${el.tagName.toLowerCase()} ${campo.type} "${(campo.getAttribute("aria-label") || campo.name || "").slice(0, 40)}" (${estilo.fontSize})`);
        }
      });
      return achados;
    });
    expect(camposPequenos, "campo com fonte abaixo de 16px (o iPhone da zoom)").toEqual([]);
  }
}

/**
 * O botao nao esta coberto por outra coisa (a capsula das abas, uma barra
 * fixa): o toque no centro dele cai nele. `toBeInViewport` sozinho nao pega:
 * um botao coberto ainda esta dentro da area visivel (achado da V7, Objetivo:
 * a capsula das abas cobria metade do "escrever o roteiro").
 */
async function conferirNaoCoberto(alvo: Locator) {
  const coberto = await alvo.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(topo && (topo === el || el.contains(topo)));
  });
  expect(coberto, "o toque no centro do botao cai em outra coisa (coberto por uma barra fixa)").toBe(false);
}

/**
 * V7, item 1: a folha fecha por Voltar (o botao do Android e o gesto do
 * iPhone), por Esc, por toque fora e, no celular, arrastando a alca para
 * baixo, sempre sem sair da tela e sem deixar entrada fantasma no historico.
 */
async function conferirFolhaFecha(
  page: Page,
  { abrir, dialogo, arrasta }: { abrir: () => Promise<void>; dialogo: Locator; arrasta: boolean },
) {
  const urlAntes = page.url();
  const semMarcaNoHistorico = async () => expect(await page.evaluate(() => history.state?.folhaAberta ?? null)).toBeNull();

  await abrir();
  await expect(dialogo).toBeVisible();
  await page.goBack();
  await expect(dialogo).toBeHidden();
  expect(page.url(), "o Voltar fechou a folha, nao saiu da tela").toBe(urlAntes);

  await abrir();
  await expect(dialogo).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
  expect(page.url()).toBe(urlAntes);
  await semMarcaNoHistorico();

  await abrir();
  await expect(dialogo).toBeVisible();
  await page.mouse.click(5, 120);
  await expect(dialogo).toBeHidden();
  expect(page.url()).toBe(urlAntes);
  await semMarcaNoHistorico();

  if (arrasta) {
    await abrir();
    await expect(dialogo).toBeVisible();
    const caixa = (await dialogo.boundingBox())!;
    const x = caixa.x + caixa.width / 2;
    await page.mouse.move(x, caixa.y + 14);
    await page.mouse.down();
    for (let passo = 1; passo <= 8; passo++) await page.mouse.move(x, caixa.y + 14 + passo * 25);
    await page.mouse.up();
    await expect(dialogo).toBeHidden();
    expect(page.url()).toBe(urlAntes);
    await semMarcaNoHistorico();
  }
}

test.describe("layout: Hoje, Roteiro e Gravação em 390, 1024 e 1280", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): se a pessoa de teste já existe, a
    // primeira passada já criou tudo o que ela precisa (mesmo padrão de `marcas.spec.ts`, PR #47).
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-layout"));
    if (jaExiste) {
      /**
       * M4, achado rodando a suíte várias vezes seguidas localmente sem resetar o banco: o cedo
       * demais aqui saía sem nunca atribuir `roteiroId` (só acontecia na primeira passada, dentro
       * do bloco abaixo), e toda rodada seguinte navegava para `/roteiros/undefined`, que redireciona
       * para `/hoje` (a guarda de `roteiroPorId` em `src/app/roteiros/[id]/gravar/page.tsx` e
       * `src/app/(painel)/(completo)/roteiros/[id]/page.tsx`). Os testes de Roteiro, Gravação e da
       * folha reprovar dependem de `roteiroId`; busca o roteiro já existente antes de sair.
       */
      const [cliente] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, "e2e-layout"));
      const [roteiro] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.clienteId, cliente.id));
      roteiroId = roteiro.id;
      return;
    }

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
      .values({ usuarioId: "e2e-layout", nome: "[teste] Layout", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-layout", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-layout", aceitouTermosEm: new Date() });

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
      cartoes: null,
      porQueAssim: [],
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
      forcaEvidencia: "media",
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
        alcance: "brasil",
        nichoId: nicho.id,
      })
      .returning();
    await db()
      .insert(membrosMarca)
      .values({ usuarioId: "e2e-layout-comecar", clienteId: clienteComecar.id, papel: "dono" });
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
      })
      .returning();
    await db()
      .insert(membrosMarca)
      .values({ usuarioId: "e2e-layout-briefing", clienteId: clienteBriefing.id, papel: "dono" });
    await db()
      .insert(preferenciasUsuario)
      .values({ usuarioId: "e2e-layout-briefing", aceitouTermosEm: new Date() });
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

    /**
     * Regras do cliente (E27 parte 2, item 4): uma ativa e uma desativada,
     * para o cartao "o que a gente aprendeu com voce" ter os dois botoes
     * ("Não é bem assim" e "Desfazer") de verdade na medicao de alvo de
     * toque, nao so o estado vazio.
     */
    await db()
      .insert(aprendizadoCliente)
      .values([
        { clienteId: clienteBriefing.id, regra: "Não começar com pergunta.", motivoOrigem: "gancho_fraco", contagem: 2 },
        {
          clienteId: clienteBriefing.id,
          regra: "Nada mais longo que 45 segundos.",
          motivoOrigem: "muito_longo",
          contagem: 1,
          ativa: false,
          desativadaEm: new Date(),
        },
      ]);

    /**
     * Pessoa com duas marcas (V3, item 3): so para a folha "Suas marcas"
     * ter conteudo de verdade nas tres larguras. Duas marcas bastam, o
     * conteudo de /hoje em si nao importa aqui (isso e `marcas.spec.ts`).
     */
    await db().insert(user).values({ id: "e2e-layout-marcas", name: "[teste] Layout Marcas", email: EMAIL_MARCAS });
    await db()
      .insert(account)
      .values({
        id: "e2e-layout-marcas-credential",
        issuer: "local:credential",
        accountId: "e2e-layout-marcas",
        providerId: "credential",
        userId: "e2e-layout-marcas",
        password: await hashPassword(SENHA),
      });
    for (const nomeMarca of ["[teste] Layout Marca Um", "[teste] Layout Marca Dois"]) {
      const [marca] = await db()
        .insert(clientes)
        .values({ usuarioId: "e2e-layout-marcas", nome: nomeMarca, nichoId: nicho.id })
        .returning();
      await db().insert(membrosMarca).values({ usuarioId: "e2e-layout-marcas", clienteId: marca.id, papel: "dono" });
      await db()
        .insert(briefings)
        .values({
          clienteId: marca.id,
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
    }
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-layout-marcas", aceitouTermosEm: new Date() });
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

    /**
     * V3, item 3: abaixo de 768px quem mostra a folha "Suas marcas" e a
     * pilula do celular (role="dialog"); a partir de 768 e o pe da barra
     * lateral (role="menu"), mesmo recolhida no iPad (so o circulo, o
     * aria-label continua).
     */
    test(`Hoje, folha "Suas marcas" aberta, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarComo(page, EMAIL_MARCAS);
      await expect(page).toHaveURL(/\/hoje/);

      await page.getByRole("button", { name: /^Trocar de marca/ }).click();
      const suasMarcas =
        largura < 768
          ? page.getByRole("dialog", { name: "Suas marcas" })
          : page.getByRole("menu", { name: "Suas marcas" });
      await expect(suasMarcas).toBeVisible();
      await conferirLayout(page);
    });

    /**
     * V7, item 8: a faixa "Sem conexão" no topo empurra o cabeçalho, a barra de topo e o corpo em vez
     * de ficar por cima (`--area-topo`, base.css): nada de rolagem horizontal, nenhum alvo pequeno, e o
     * toque no centro da pílula de marca (Hoje, Conta) e do botão Voltar (Roteiro) cai neles.
     */
    if (largura < 768) {
      // A pílula de marca só existe com mais de uma marca: Hoje e Conta entram com o usuário de duas marcas.
      for (const { tela, entrarNa, ir, alvo } of [
        {
          tela: "Hoje",
          entrarNa: async (page: Page) => {
            await entrarComo(page, EMAIL_MARCAS);
            await expect(page).toHaveURL(/\/hoje/);
          },
          ir: async (page: Page) => page.goto("/hoje"),
          alvo: (page: Page) => page.getByRole("button", { name: /^Trocar de marca/ }),
        },
        {
          tela: "Roteiro",
          entrarNa: entrar,
          ir: async (page: Page) => page.goto(`/roteiros/${roteiroId}`),
          alvo: (page: Page) => page.getByRole("link", { name: "Voltar" }).first(),
        },
        {
          tela: "Conta",
          entrarNa: async (page: Page) => {
            await entrarComo(page, EMAIL_MARCAS);
            await expect(page).toHaveURL(/\/hoje/);
          },
          ir: async (page: Page) => page.goto("/conta"),
          alvo: (page: Page) => page.getByRole("button", { name: /^Trocar de marca/ }),
        },
      ]) {
        test(`${tela}, faixa "Sem conexão" visível, em ${rotulo}px`, async ({ page, context }) => {
          await page.setViewportSize({ width: largura, height: altura });
          await entrarNa(page);
          await ir(page);
          await page.waitForLoadState("networkidle");
          await context.setOffline(true);
          await expect(page.getByRole("status").filter({ hasText: textosConexao.faixa })).toBeVisible();
          await conferirLayout(page);
          await conferirNaoCoberto(alvo(page));
        });
      }
    }

    /**
     * V7, item 1: a folha do Roteiro ("O que não ficou bom?", aberta pelo menu) fecha por Voltar, Esc,
     * toque fora e, no celular, arrastando; e o campo de texto dela mantém o foco a cada tecla (o
     * `.fill()` dos outros testes escreve tudo de uma vez e nunca pegaria o foco pulando).
     */
    test(`Roteiro, folha reprovar fecha por Voltar, Esc, toque fora e arrastar, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto(`/roteiros/${roteiroId}`);
      await page.waitForLoadState("networkidle");
      await conferirFolhaFecha(page, {
        abrir: async () => {
          await page.getByRole("button", { name: "Mais opções" }).click();
          await page.getByRole("menuitem", { name: "Reprovar" }).click();
        },
        dialogo: page.getByRole("dialog", { name: "O que não ficou bom?" }),
        arrasta: largura < 768,
      });
    });

    test(`Roteiro, campo da folha reprovar mantém o foco tecla a tecla, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto(`/roteiros/${roteiroId}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Mais opções" }).click();
      await page.getByRole("menuitem", { name: "Reprovar" }).click();
      const campo = page.getByLabel("Se quiser, diga com as suas palavras");
      await campo.click();
      await campo.pressSequentially("o gancho", { delay: 30 });
      await expect(campo).toBeFocused();
      await expect(campo).toHaveValue("o gancho");
    });

    /** V7, item 1: a folha "Suas marcas" (celular) e as doze notas fecham por Voltar e Esc, sem sair da tela. */
    if (largura < 768) {
      test(`Hoje, folha "Suas marcas" fecha por Voltar, Esc, toque fora e arrastar, em ${rotulo}px`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: altura });
        await entrarComo(page, EMAIL_MARCAS);
        await expect(page).toHaveURL(/\/hoje/);
        await page.waitForLoadState("networkidle");
        await conferirFolhaFecha(page, {
          abrir: async () => {
            await page.getByRole("button", { name: /^Trocar de marca/ }).click();
          },
          dialogo: page.getByRole("dialog", { name: "Suas marcas" }),
          arrasta: true,
        });
      });
    }

    /** V7, item 1: as cinco telas do caminho da viagem que layout.spec.ts ainda não cobria. */
    test(`Entrar em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await page.goto("/entrar");
      await expect(page.getByRole("heading", { name: "Bom te ver" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Tema livre em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto("/hoje/tema-livre");
      await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Objetivo em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto(`/hoje/objetivo?livre=${encodeURIComponent("um assunto de teste para o layout")}`);
      await expect(page.getByRole("heading", { name: "O que você quer que esse vídeo faça?" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Histórico em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto("/historico");
      await expect(page.getByRole("heading", { name: "Histórico" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Conta em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(page);
      await page.goto("/conta");
      await expect(page.getByRole("heading", { name: "Conta" })).toBeVisible();
      await conferirLayout(page);
    });
  }

  /**
   * V15, item 7, com a correção pedida pelo Fable na revisão (os testes anteriores passaram com
   * três telas quebradas: só conferiam "sem rolagem horizontal", que não pega a coluna de leitura
   * espremida nem o lado sobrepondo nada). Mede de verdade: a coluna de leitura tem pelo menos
   * 30rem (achado da revisão: `.miolo` do Roteiro ainda limitava tudo a `--largura-leitura`,
   * deixando a coluna com uns 230px); o lado nunca sobrepõe a coluna (achado: um `display: contents`
   * sem `@media` depois do bloco de 1024px, no Tema livre, desfazia o `display: grid` da coluna
   * principal, e o campo caía na coluna do lado); e a largura do conteúdo a 1920 é a mesma de 1280
   * (achado: `padding-inline` com porcentagem resolve contra a barra inteira, barra lateral
   * incluída, não contra o que sobra depois dela — `.corpo` encolhia para uns 690px em vez de
   * ficar nos 944 do "monitor largo"; a correção trocou para `max-width` mais `margin-inline: auto`).
   */
  const MINIMO_COLUNA_LEITURA = 480; // 30rem

  async function medirColunaELado(page: Page, seletorColuna: string, seletorLado: string) {
    const coluna = await page.locator(seletorColuna).first().boundingBox();
    const lado = await page.locator(seletorLado).first().boundingBox();
    expect(coluna, `coluna de leitura (${seletorColuna}) não encontrada`).not.toBeNull();
    expect(lado, `lado (${seletorLado}) não encontrado`).not.toBeNull();
    expect(coluna!.width, "coluna de leitura abaixo de 30rem (480px)").toBeGreaterThanOrEqual(
      MINIMO_COLUNA_LEITURA,
    );
    expect(lado!.x, "o lado sobrepõe a coluna de leitura").toBeGreaterThanOrEqual(
      coluna!.x + coluna!.width,
    );
    return coluna!.width;
  }

  const TELAS_COM_LADO = [
    {
      tela: "Objetivo",
      ir: async (page: Page) =>
        page.goto(`/hoje/objetivo?livre=${encodeURIComponent("um assunto de teste para o layout")}`),
      esperar: (page: Page) => page.getByText("Tema escolhido", { exact: false }).waitFor(),
      seletorColuna: '[class*="colunaPrincipal"]',
      seletorLado: '[class*="temaEscolhido"]',
    },
    {
      tela: "Tema livre",
      ir: async (page: Page) => page.goto("/hoje/tema-livre"),
      esperar: (page: Page) => page.getByText("Os cinco pontos que a gente olha").waitFor(),
      seletorColuna: '[class*="colunaPrincipal"]',
      seletorLado: '[class*="cincoPontos"]',
    },
    {
      tela: "Roteiro",
      ir: async (page: Page) => page.goto(`/roteiros/${roteiroId}`),
      esperar: (page: Page) => page.getByRole("heading", { name: "Como editar" }).waitFor(),
      seletorColuna: '[class*="blocos"]',
      seletorLado: '[class*="ladoGrudado"]',
    },
    {
      tela: "Conta",
      ir: async (page: Page) => page.goto("/conta"),
      esperar: (page: Page) => page.getByText("Quem tem acesso a esta marca").waitFor(),
      seletorColuna: '[class*="colunaPrincipal"]',
      seletorLado: '[class*="acessos"]',
    },
  ];

  for (const largura of [1024, 1280, 1920]) {
    for (const { tela, ir, esperar, seletorColuna, seletorLado } of TELAS_COM_LADO) {
      test(`${tela}, a coluna tem 30rem e o lado não sobrepõe, em ${largura}px`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 900 });
        await entrar(page);
        await ir(page);
        await esperar(page);
        await medirColunaELado(page, seletorColuna, seletorLado);
        await conferirLayout(page);
      });
    }
  }

  /**
   * "A largura do conteúdo a 1920 é igual à de 1280" (achado 2 da revisão): mede a mesma coluna nas
   * duas larguras e confere que a diferença é só arredondamento de viewport, não a grade encolhendo.
   */
  const TOLERANCIA_PX = 20;
  for (const { tela, ir, esperar, seletorColuna } of TELAS_COM_LADO) {
    test(`${tela}: a coluna de leitura a 1920px tem a mesma largura que a 1280px`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await entrar(page);
      await ir(page);
      await esperar(page);
      const coluna1280 = await page.locator(seletorColuna).first().boundingBox();
      expect(coluna1280, `coluna de leitura (${seletorColuna}) não encontrada a 1280px`).not.toBeNull();

      await page.setViewportSize({ width: 1920, height: 900 });
      await page.waitForTimeout(100);
      const coluna1920 = await page.locator(seletorColuna).first().boundingBox();
      expect(coluna1920, `coluna de leitura (${seletorColuna}) não encontrada a 1920px`).not.toBeNull();
      expect(
        Math.abs(coluna1920!.width - coluna1280!.width),
        `coluna de leitura mudou de largura entre 1280px (${coluna1280!.width}) e 1920px (${coluna1920!.width})`,
      ).toBeLessThanOrEqual(TOLERANCIA_PX);
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

    /** V7, item 1: as doze notas fecham por Voltar, Esc e toque fora (a folha não desenha alça: sem arrastar). */
    test(`Começar, folha "as doze notas" fecha por Voltar, Esc e toque fora, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarComo(page, EMAIL_COMECAR);
      await expect(page).toHaveURL(/\/comecar/);
      await page.waitForLoadState("networkidle");
      await conferirFolhaFecha(page, {
        abrir: async () => {
          await page.getByRole("button", { name: "as doze notas" }).click();
        },
        dialogo: page.getByRole("dialog", { name: "as doze notas" }),
        arrasta: false,
      });
    });
  }

  /**
   * V7, item 3: "o botão principal está dentro da área visível com a viewport
   * reduzida a 390 x 500 (teclado)". Só nas telas com um botão principal
   * claro; Hoje (três cartões), Briefing (revisão), Referências (grade) e
   * Começar (formulário em blocos) não têm um botão único e ficam de fora
   * (decisão registrada em "Decisões pendentes" do TODO.md).
   */
  for (const { rotulo, nome, ir, botao, conferirCobertura = true } of [
    { rotulo: "Entrar", nome: "entrar", ir: async (page: Page) => page.goto("/entrar"), botao: "entrar" },
    {
      rotulo: "Tema livre",
      nome: "Avaliar o tema",
      ir: async (page: Page) => {
        await entrar(page);
        await page.goto("/hoje/tema-livre");
      },
      botao: "Avaliar o tema",
      // A cápsula das abas some quando o teclado abre (`useTecladoAberto`, item 0c); o Playwright encolhe a
      // janela inteira, sem a diferença entre `innerHeight` e `visualViewport` que o teclado de verdade cria, então
      // aqui a cápsula continua na tela e cobre o botão: só a versão em `toBeInViewport` faz sentido.
      conferirCobertura: false,
    },
    {
      rotulo: "Objetivo",
      nome: "escrever o roteiro",
      ir: async (page: Page) => {
        await entrar(page);
        await page.goto(`/hoje/objetivo?livre=${encodeURIComponent("um assunto de teste para o layout")}`);
      },
      botao: "escrever o roteiro",
    },
    {
      rotulo: "Roteiro",
      nome: "Já gravei",
      ir: async (page: Page) => {
        await entrar(page);
        await page.goto(`/roteiros/${roteiroId}`);
      },
      botao: "Já gravei",
    },
    {
      rotulo: "Gravação",
      nome: "Próximo bloco",
      ir: async (page: Page) => {
        await entrar(page);
        await page.goto(`/roteiros/${roteiroId}/gravar`);
      },
      botao: "Próximo bloco",
    },
    {
      rotulo: "Roteiro, folha reprovar",
      nome: "Reescrever com isso em mente",
      ir: async (page: Page) => {
        await entrar(page);
        await page.goto(`/roteiros/${roteiroId}`);
        await page.getByRole("button", { name: "Mais opções" }).click();
        await page.getByRole("menuitem", { name: "Reprovar" }).click();
        await expect(page.getByRole("dialog", { name: "O que não ficou bom?" })).toBeVisible();
      },
      botao: "Reescrever com isso em mente",
    },
  ]) {
    test(`${rotulo}, botão "${nome}" visível a 390x500`, async ({ page }) => {
      // Carrega em tamanho cheio e só depois encolhe: simula o teclado abrindo numa tela já
      // carregada (o que dispara o listener de `visualViewport`, `TemaLivreTela.tsx`), não uma
      // tela que já nasce pequena, que nenhum aparelho de verdade produz.
      await page.setViewportSize({ width: 390, height: 844 });
      await ir(page);
      // Espera a hidratacao: o teclado so abre depois de o usuario tocar no campo, e o listener de
      // `visualViewport` da tela so existe depois de hidratar (sem isto o teste encolhe antes e
      // mede uma corrida, nao o produto; mesma convencao de tema-livre.spec.ts).
      await page.waitForLoadState("networkidle");
      await page.setViewportSize({ width: 390, height: 500 });
      const principal = page.getByRole("button", { name: botao, exact: true });
      await expect(principal).toBeInViewport();
      if (conferirCobertura) await conferirNaoCoberto(principal);
    });
  }

  /**
   * H3, item 5: "não dá para provar no Playwright o que é do iPhone" continua
   * valendo (o Playwright encolhe `window.innerHeight` e `visualViewport`
   * juntos, sem a diferença entre os dois que o teclado de verdade cria no
   * iPhone em modo aplicativo, comentário do loop acima); o que dá para
   * confirmar aqui é que encolher a viewport e devolver ao tamanho cheio
   * nunca deixa nada preso: a cápsula das abas volta a aparecer, no pé da
   * tela, e o corpo da página continua alcançável.
   */
  test("Hoje: encolher a viewport (simula o teclado) e devolver ao tamanho cheio traz a cápsula das abas de volta ao pé, sem nada preso", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);
    await page.waitForLoadState("networkidle");

    const capsula = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(capsula).toBeInViewport();

    await page.setViewportSize({ width: 390, height: 500 });
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(capsula).toBeInViewport();
    const caixa = await capsula.boundingBox();
    if (!caixa) throw new Error("cápsula sem caixa delimitadora");
    // No pé da tela, não a meio caminho (a exata forma do defeito do item 3: uma peça fixa
    // flutuando onde o teclado costumava terminar, em vez de voltar para onde deveria estar).
    expect(caixa.y + caixa.height).toBeGreaterThan(800);
  });
});

/**
 * Referências no design v2 (V6, D2 parte 3a): 390, 820 e 1280 (o iPad Air em
 * pé, como a V5 e a V5b passaram a usar), não 1024. Estados normal, filtrar
 * e detalhes.
 */
const EMAIL_REFERENCIAS = "e2e-layout-referencias@exemplo.teste";
const LARGURAS_V6 = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "360", largura: 360, altura: 740 },
  { rotulo: "820", largura: 820, altura: 1180 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];

test.describe("layout: Referências (V6) em 390, 820 e 1280", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver o describe acima.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-layout-referencias"));
    if (jaExiste) return;

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-layout-referencias", nome: "[teste] Layout Referências" })
      .returning();

    await db().insert(user).values({ id: "e2e-layout-referencias", name: "[teste] Layout Referências", email: EMAIL_REFERENCIAS });
    await db()
      .insert(account)
      .values({
        id: "e2e-layout-referencias-credential",
        issuer: "local:credential",
        accountId: "e2e-layout-referencias",
        providerId: "credential",
        userId: "e2e-layout-referencias",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-layout-referencias", nome: "[teste] Layout Referências", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-layout-referencias", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-layout-referencias", aceitouTermosEm: new Date() });

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
        plataforma: "instagram",
        handle: "@e2e-layout-referencias",
        nome: "[teste] Casa em Ordem",
        nichoId: nicho.id,
        medianaViews: "5000",
        medianaOrigem: "conta",
      })
      .returning();

    await db()
      .insert(videos)
      .values({
        plataforma: "instagram",
        idExterno: "e2e-layout-referencias-1",
        url: "https://exemplo.invalido/e2e-layout-referencias-1",
        nichoId: nicho.id,
        contaId: conta.id,
        titulo: "o produto que tira qualquer mancha do estofado, um titulo bem comprido para testar a reticencia",
        views: 120000,
        foraDaCurva: "24.0",
        velocidade: "4000",
        idioma: "pt",
        publicadoEm: new Date(),
        analise: {
          assunto: "mancha em estofado",
          gancho: "Abre com a mao ja esfregando a mancha, sem falar por dois segundos.",
          estrutura: "Aplica o produto sem cortar o video, falando o tempo de espera em voz alta.",
          fechamento: "Resumo do antes e depois.",
          chamadaFinal: "Comenta se voce ja passou por isso.",
          formato: "fala_para_camera",
          porQueFuncionou: "A pessoa ve o problema dela na tela nos dois primeiros segundos e fica para saber se resolve.",
        } as never,
      });
  });

  async function entrarReferencias(page: Page) {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL_REFERENCIAS);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);
  }

  for (const { rotulo, largura, altura } of LARGURAS_V6) {
    test(`Referências, normal, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarReferencias(page);
      await page.goto("/referencias");
      await expect(page.getByRole("heading", { name: "O que está funcionando no seu setor" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Referências, folha filtrar, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarReferencias(page);
      await page.goto("/referencias");
      await page.getByRole("button", { name: "Filtrar" }).click();
      await expect(page.getByRole("dialog", { name: "Filtrar" })).toBeVisible();
      await conferirLayout(page);
    });

    test(`Referências, folha detalhes, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarReferencias(page);
      await page.goto("/referencias");
      await page.getByRole("button", { name: "Ver detalhes" }).first().click();
      await expect(page.getByRole("dialog", { name: "Por que esse funcionou" })).toBeVisible();
      await conferirLayout(page);
    });

    /** V7, item 1: as duas folhas de Referências fecham por Voltar, Esc, toque fora e, no celular, arrastando. */
    test(`Referências, folha detalhes fecha por Voltar, Esc, toque fora e arrastar, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarReferencias(page);
      await page.goto("/referencias");
      await page.waitForLoadState("networkidle");
      await conferirFolhaFecha(page, {
        abrir: async () => {
          await page.getByRole("button", { name: "Ver detalhes" }).first().click();
        },
        dialogo: page.getByRole("dialog", { name: "Por que esse funcionou" }),
        arrasta: largura < 768,
      });
    });

    test(`Referências, folha filtrar fecha por Voltar, Esc, toque fora e arrastar, em ${rotulo}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrarReferencias(page);
      await page.goto("/referencias");
      await page.waitForLoadState("networkidle");
      await conferirFolhaFecha(page, {
        abrir: async () => {
          await page.getByRole("button", { name: "Filtrar" }).click();
        },
        dialogo: page.getByRole("dialog", { name: "Filtrar" }),
        arrasta: largura < 768,
      });
    });
  }
});

/**
 * Item 9, V12b: o `/comecar` no desktop, achado do Gustavo em produção com
 * um ramo comprido de verdade ("Empreendedorismo e Construção de Marcas").
 * Nicho e cliente próprios, sem dados fixos (cai em "intro", "Começar" leva
 * ao passo do ramo, já com o nicho do cliente selecionado).
 */
const EMAIL_COMECAR_DESKTOP = "e2e-layout-comecar-desktop@exemplo.teste";
const NOME_RAMO_COMPRIDO = "Empreendedorismo e Construção de Marcas";

let nichoComecarDesktopId: number;

test.describe("layout: /comecar no desktop (item 9, V12b)", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): a primeira passada já criou tudo;
    // só falta o id do nicho, que esta rodada não guardou em nenhuma variável de módulo (`nichoComecarDesktopId`
    // não sobrevive entre tentativas do Playwright, cada uma é um processo novo).
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-layout-comecar-desktop"));
    if (jaExiste) {
      const [nichoExistente] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, "e2e-layout-comecar-desktop"));
      nichoComecarDesktopId = nichoExistente.id;
      return;
    }

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-layout-comecar-desktop", nome: NOME_RAMO_COMPRIDO })
      .returning();
    nichoComecarDesktopId = nicho.id;

    await db()
      .insert(user)
      .values({ id: "e2e-layout-comecar-desktop", name: "[teste] Layout Começar Desktop", email: EMAIL_COMECAR_DESKTOP });
    await db()
      .insert(account)
      .values({
        id: "e2e-layout-comecar-desktop-credential",
        issuer: "local:credential",
        accountId: "e2e-layout-comecar-desktop",
        providerId: "credential",
        userId: "e2e-layout-comecar-desktop",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-layout-comecar-desktop", nome: "[teste] Layout Começar Desktop", nichoId: nicho.id })
      .returning();
    await db()
      .insert(membrosMarca)
      .values({ usuarioId: "e2e-layout-comecar-desktop", clienteId: cliente.id, papel: "dono" });
  });

  async function abrirPassoDoRamo(page: Page) {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL_COMECAR_DESKTOP);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/comecar/);
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await expect(page.locator("#ramo")).toBeVisible();
  }

  for (const largura of [1024, 1280, 1920]) {
    test(`a coluna fica centralizada e o nome do ramo aparece inteiro, em ${largura}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await abrirPassoDoRamo(page);

      const select = page.locator("#ramo");
      await expect(select).toHaveValue(String(nichoComecarDesktopId));

      // O select mostra a opção escolhida por inteiro (o navegador não corta o texto da option marcada).
      const textoOpcaoMarcada = await select.evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex]?.text);
      expect(textoOpcaoMarcada).toBe(NOME_RAMO_COMPRIDO);

      // A coluna do formulário fica centralizada, não colada na margem esquerda (folga dos dois lados parecida).
      const caixa = await page.locator("form").boundingBox();
      expect(caixa, "o formulário precisa estar visível").not.toBeNull();
      const folgaEsquerda = caixa!.x;
      const folgaDireita = largura - (caixa!.x + caixa!.width);
      expect(
        Math.abs(folgaEsquerda - folgaDireita),
        `folgas muito diferentes (esquerda ${folgaEsquerda}, direita ${folgaDireita}): a coluna não está centralizada`,
      ).toBeLessThan(caixa!.width * 0.15);

      await conferirLayout(page);
    });
  }
});
