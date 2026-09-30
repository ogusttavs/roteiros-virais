/**
 * `/referencias` no design v2 (V6, D2 parte 3a, `Referencias.dc.html`):
 * trocar de segmento, filtrar por plataforma pela folha e ver o contador
 * no botão, abrir "Ver detalhes" e ver as três partes da análise, salvar
 * pela folha e ver em "Salvos", o estado vazio com "Ver os últimos 30 dias"
 * mudando a URL. Roteiro próprio ("e2e-referencias"), sem `resetarSchema`
 * (mesma lição de `roteiro.spec.ts`): o seed roda uma vez só, no
 * globalSetup.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contas, membrosMarca, nichos, preferenciasUsuario, user, videos } from "../../src/db/schema";
import { textosNav } from "../../src/textos/nav";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-referencias@exemplo.teste";
const NOME_MARCA_UM = "[teste] Referências Um";
const NOME_MARCA_DOIS = "[teste] Referências Dois";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/**
 * Troca para a Marca Dois se a marca ativa ainda não for ela: dois testes
 * dependem da ordem em que rodam (a marca ativa segue o acesso mais
 * recente), então trocam só se precisar. Espera de verdade por uma das duas
 * pílulas (`.or`) antes de checar qual está visível: um `isVisible()` sem
 * espera nenhuma antes respondia falso cedo demais com a máquina ocupada, e
 * o teste ficava esperando um botão que não existia (H3, item 0, achado na
 * revisão do PR #66).
 */
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

function analiseExemplo(assunto: string, formato: "fala_para_camera" | "podcast" = "fala_para_camera") {
  return {
    assunto,
    gancho: "Abre com a mao ja esfregando a mancha, sem falar por dois segundos.",
    estrutura: "Aplica o produto sem cortar o video, falando o tempo de espera em voz alta.",
    fechamento: "Resumo do antes e depois.",
    chamadaFinal: "Comenta se voce ja passou por isso.",
    formato,
    porQueFuncionou: "A pessoa ve o problema dela na tela nos dois primeiros segundos e fica para saber se resolve.",
  };
}

test.describe("/referencias no design v2", () => {
  test.beforeAll(async () => {
    // Seguro para a repeticao automatica do Playwright (item 0c, 29/09/2026): com `retries: 1` em CI, a
    // segunda tentativa roda este `beforeAll` de novo no mesmo worker e batia na chave unica do usuario,
    // e assim a tentativa que poderia deixar o rastro da corrida morria antes de comecar. Se a pessoa de
    // teste ja existe, tudo o que ela precisa ja foi criado pela primeira passada; nada a fazer.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-referencias"));
    if (jaExiste) return;

    const [nichoUm] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
    const [nichoDois] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    await db().insert(user).values({ id: "e2e-referencias", name: "[teste] Referencias", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-referencias-credential",
        issuer: "local:credential",
        accountId: "e2e-referencias",
        providerId: "credential",
        userId: "e2e-referencias",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-referencias", aceitouTermosEm: new Date() });

    // Dois primeiro, Um depois: marcaPadrao (sem cookie ainda) usa a de criacao mais
    // recente, e os testes abaixo pressupoe que a marca ativa no primeiro login e a Um
    // (mesmo raciocinio de tema-livre.spec.ts).
    const [marcaDois] = await db()
      .insert(clientes)
      // Item 8, V12b: "tiktok" nao tem nenhum video no nicho de dentistas (so
      // youtube abaixo), a rede principal sem video do teste do prefiltro.
      .values({ usuarioId: "e2e-referencias", nome: NOME_MARCA_DOIS, nichoId: nichoDois.id, redePrincipal: "tiktok" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-referencias", nome: NOME_MARCA_UM, nichoId: nichoUm.id })
      .returning();
    await db()
      .insert(membrosMarca)
      .values([
        { usuarioId: "e2e-referencias", clienteId: cliente.id, papel: "dono" },
        { usuarioId: "e2e-referencias", clienteId: marcaDois.id, papel: "dono" },
      ]);

    await db()
      .insert(briefings)
      .values([
        {
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
        },
        {
          clienteId: marcaDois.id,
          completo: true,
          perfil: {
            fatos: {
              oQueVende: "consultas odontologicas",
              preco: "consulta a partir de 150 reais",
              clienteIdeal: "familia da regiao",
              medos: [],
              frasesDaFala: [],
              proibicoes: [],
              cenasFilmaveis: [],
              concorrentes: [],
              perfisAdmirados: [],
            },
            resumo: "clinica odontologica de bairro",
            referencias: [],
          },
        },
      ]);

    const [contaDentista] = await db()
      .insert(contas)
      .values({
        plataforma: "youtube",
        handle: "@e2e-referencias-dentista",
        nome: "[teste] Sorriso em Dia",
        nichoId: nichoDois.id,
        medianaViews: "3000",
        medianaOrigem: "conta",
      })
      .returning();
    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-referencias-dentista-1",
        url: "https://exemplo.invalido/e2e-referencias-dentista-1",
        nichoId: nichoDois.id,
        contaId: contaDentista.id,
        titulo: "o aparelho que corrigiu o sorriso em seis meses",
        views: 60000,
        foraDaCurva: "20.0",
        velocidade: "3000",
        idioma: "pt",
        publicadoEm: new Date(),
        analise: analiseExemplo("aparelho ortodontico") as never,
      });
    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-referencias-dentista-embed",
        // Vídeo real do YouTube ("Me at the zoo", o primeiro do site, estável e sempre no ar),
        // só para este teste confirmar que a folha "Ver detalhes" carrega o iframe de verdade
        // (V9d, item 0b, sub-item 4: o observador do VideoEmbed precisa disparar dentro da folha).
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        nichoId: nichoDois.id,
        contaId: contaDentista.id,
        titulo: "video de teste do embed dentro da folha",
        views: 65000,
        foraDaCurva: "18.0",
        velocidade: "2500",
        idioma: "pt",
        publicadoEm: new Date(),
        analise: analiseExemplo("embed de teste") as never,
      });

    const [contaInstagram] = await db()
      .insert(contas)
      .values({
        plataforma: "instagram",
        handle: "@e2e-referencias-instagram",
        nome: "[teste] Casa em Ordem",
        nichoId: nichoUm.id,
        medianaViews: "5000",
        medianaOrigem: "conta",
      })
      .returning();
    const [contaTiktok] = await db()
      .insert(contas)
      .values({
        plataforma: "tiktok",
        handle: "@e2e-referencias-tiktok",
        nome: "[teste] Limpeza da Ana",
        nichoId: nichoUm.id,
        medianaViews: "8000",
        medianaOrigem: "conta",
      })
      .returning();

    await db()
      .insert(videos)
      .values({
        plataforma: "instagram",
        idExterno: "e2e-referencias-instagram-1",
        url: "https://exemplo.invalido/e2e-referencias-instagram-1",
        nichoId: nichoUm.id,
        contaId: contaInstagram.id,
        titulo: "o produto que tira qualquer mancha do estofado",
        views: 120000,
        foraDaCurva: "24.0",
        velocidade: "4000",
        idioma: "pt",
        publicadoEm: new Date(),
        analise: analiseExemplo("mancha em estofado") as never,
      });

    await db()
      .insert(videos)
      .values({
        plataforma: "tiktok",
        idExterno: "e2e-referencias-tiktok-1",
        url: "https://exemplo.invalido/e2e-referencias-tiktok-1",
        nichoId: nichoUm.id,
        contaId: contaTiktok.id,
        titulo: "organizando o guarda roupa em dez minutos",
        views: 40000,
        foraDaCurva: "5.0",
        velocidade: "900",
        idioma: "pt",
        publicadoEm: new Date(),
        analise: analiseExemplo("organizacao do guarda roupa", "podcast") as never,
      });
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("mostra os vídeos fora da curva, com o número que fez cada um ser fora da curva", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    await expect(page.getByRole("heading", { name: "O que está funcionando no seu setor" })).toBeVisible();
    await expect(page.getByText("2 vídeos fora da curva nos últimos 7 dias")).toBeVisible();

    const cartaoInstagram = page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" });
    await expect(cartaoInstagram.getByText("24,0x")).toBeVisible();
    await expect(cartaoInstagram.getByText("acima do normal dessa conta")).toBeVisible();
    await expect(cartaoInstagram.getByText("120.000 views")).toBeVisible();
    await expect(cartaoInstagram.getByText("normal dessa conta: 5.000")).toBeVisible();
    await expect(cartaoInstagram.getByText("4.000 views por hora")).toBeVisible();
  });

  test("trocar de segmento para Salvos mostra só os vídeos salvos", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    await page.getByRole("tab", { name: "Salvos" }).click();
    await expect(page).toHaveURL(/seg=salvos/);
    await expect(page.getByText("Nenhum vídeo salvo ainda")).toBeVisible();

    await page.getByRole("tab", { name: "Fora da curva" }).click();
    await expect(page).not.toHaveURL(/seg=salvos/);
  });

  test("filtrar por plataforma pela folha, o contador aparece no botão Filtrar", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    await page.getByRole("button", { name: "Filtrar" }).click();
    const folha = page.getByRole("dialog", { name: "Filtrar" });
    await expect(folha).toBeVisible();

    await folha.getByRole("button", { name: "TikTok", exact: false }).click();
    await folha.getByRole("button", { name: /Ver os \d+ vídeos?/ }).click();

    await expect(folha).not.toBeVisible();
    await expect(page).toHaveURL(/plataforma=tiktok/);
    await expect(page.getByRole("button", { name: /Filtrar, 1/ })).toBeVisible();

    const cartaoTiktok = page.locator("article", { hasText: "organizando o guarda roupa em dez minutos" });
    await expect(cartaoTiktok).toBeVisible();
    await expect(page.locator("article", { hasText: "mancha do estofado" })).not.toBeVisible();
  });

  /**
   * F1, item 2: o achado que apareceu testando o item 3. Reabrir "Filtrar" antes de uma navegação
   * anterior voltar do servidor fazia a folha nascer com `plataformasAtivas`/`formatosAtivos`
   * desatualizados; corrigido com valores otimistas na folha e o botão "Filtrar" desabilitado
   * enquanto `navegando` (modo B, achado do CI: `referencias.spec.ts:316`, volta 4, pediu tiktok,
   * ficou todas). Sob freio de CPU e um atraso aleatório no `_rsc` de cada navegação, esse ajuste
   * sozinho não bastou: o `router.replace` às vezes busca a página nova, recebe 200, e nunca termina
   * de aplicar (confirmado lendo `history.pushState`/`replaceState` e o log do próprio App Router; não
   * reproduz sem freio nem sem atraso, então não é corrida desta tela, é uma corrida mais funda dentro
   * do próprio roteador do Next). Sem a causa exata, a rede de segurança do item 2 (`navegar`, em
   * `ReferenciasTela.tsx`: se a URL pedida não chegar em 6 s, força `window.location.assign`) fecha o
   * caso: com ela este teste fica verde mesmo sob o atraso que antes travava.
   */
  test("filtrar e limpar repetido sob atraso de rede nunca trava numa URL antiga (F1, itens 2 e 3)", async ({ page }) => {
    // Generoso de propósito: sob o freio de CPU, algumas voltas podem esbarrar na rede de segurança de
    // 6s do item 2 (recarrega a página inteira); no pior caso (as 12 chamadas de `navegar` do laço
    // caindo nela), ainda cabe dentro do prazo.
    test.setTimeout(150_000);
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await page.route(
      (url) => url.pathname === "/referencias" && url.searchParams.has("_rsc"),
      async (route) => {
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 350));
        await route.continue();
      },
    );

    for (let volta = 0; volta < 6; volta++) {
      await page.getByRole("button", { name: "Filtrar" }).click();
      const folha = page.getByRole("dialog", { name: "Filtrar" });
      await expect(folha).toBeVisible();
      await folha.getByRole("button", { name: "TikTok", exact: false }).click();
      await folha.getByRole("button", { name: /Ver os \d+ vídeos?/ }).click();
      await expect(folha).not.toBeVisible();
      await expect(page, `volta ${volta}: aplicar nao mudou a URL`).toHaveURL(/plataforma=tiktok/, { timeout: 10_000 });

      await page.getByRole("button", { name: "Filtrar" }).click();
      await expect(page.getByRole("dialog", { name: "Filtrar" })).toBeVisible();
      await page.getByRole("dialog", { name: "Filtrar" }).getByRole("button", { name: "Limpar" }).click();
      await expect(page.getByRole("dialog", { name: "Filtrar" })).not.toBeVisible();
      await expect(page, `volta ${volta}: limpar nao mudou a URL`).toHaveURL(/plataforma=todas/, { timeout: 10_000 });
    }
  });

  /**
   * Ajuste A do PR #66: a mesma interação de "filtrar por plataforma pela folha", repetida várias vezes
   * na mesma página (sem recarregar, sem passar pelo `beforeAll` de novo). É a prova de robustez que a
   * revisão do Fable pediu com `--repeat-each=20`: o `--repeat-each` do Playwright recria o `beforeAll` a
   * cada repetição (achado desta rodada, com os IDs fixos do fixture colidindo, "duplicate key"), então a
   * repetição de verdade tem que morar dentro do teste, não na flag da linha de comando.
   */
  test("filtrar e limpar pela folha, repetido várias vezes seguidas, nunca fica na URL de antes", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    for (let volta = 0; volta < 10; volta++) {
      await page.getByRole("button", { name: "Filtrar" }).click();
      const folha = page.getByRole("dialog", { name: "Filtrar" });
      await expect(folha).toBeVisible();
      await folha.getByRole("button", { name: "TikTok", exact: false }).click();
      await folha.getByRole("button", { name: /Ver os \d+ vídeos?/ }).click();
      await expect(folha).not.toBeVisible();
      await expect(page, `volta ${volta}: aplicar nao mudou a URL`).toHaveURL(/plataforma=tiktok/);

      await page.getByRole("button", { name: "Filtrar" }).click();
      await expect(page.getByRole("dialog", { name: "Filtrar" })).toBeVisible();
      await page.getByRole("dialog", { name: "Filtrar" }).getByRole("button", { name: "Limpar" }).click();
      await expect(page.getByRole("dialog", { name: "Filtrar" })).not.toBeVisible();
      await expect(page, `volta ${volta}: limpar nao mudou a URL`).toHaveURL(/plataforma=todas/);
    }
  });

  /**
   * Ajuste A do PR #66: `fecharENavegar` troca a entrada que a folha empurrou pelo destino
   * (`router.replace`), em vez de `history.back()` mais `router.push`. O Voltar do aparelho, depois de
   * aplicar um filtro, precisa sair direto para a lista de antes de abrir a folha (a entrada da folha não
   * existe mais como "voltar para a folha aberta"), não ficar preso nem voltar para a folha.
   */
  test("o Voltar do aparelho depois de aplicar um filtro sai para a lista de antes, não para a folha", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");
    await expect(page).toHaveURL(/^[^?]*\/referencias$/);

    await page.getByRole("button", { name: "Filtrar" }).click();
    await page.getByRole("dialog", { name: "Filtrar" }).getByRole("button", { name: "TikTok", exact: false }).click();
    await page.getByRole("dialog", { name: "Filtrar" }).getByRole("button", { name: /Ver os \d+ vídeos?/ }).click();
    await expect(page).toHaveURL(/plataforma=tiktok/);

    await page.goBack();

    await expect(page).toHaveURL(/^[^?]*\/referencias$/);
    await expect(page.getByRole("dialog", { name: "Filtrar" })).not.toBeVisible();
    await expect(page.locator("article", { hasText: "mancha do estofado" })).toBeVisible();
  });

  test("abrir Ver detalhes mostra as três partes da análise", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    const cartao = page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();

    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(folha).toBeVisible();
    await expect(folha.getByText("Como começou")).toBeVisible();
    await expect(folha.getByText("Como construiu")).toBeVisible();
    await expect(folha.getByText("Por que funcionou")).toBeVisible();
    await expect(folha.getByRole("button", { name: "Usar como referência" })).toBeVisible();
    await expect(folha.getByRole("link", { name: "Abrir na plataforma" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(folha).not.toBeVisible();
  });

  test("salvar pela folha de detalhes e ver o vídeo em Salvos", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto("/referencias");

    const cartao = page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();

    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await folha.getByRole("button", { name: "Salvar" }).click();
    await expect(folha.getByRole("button", { name: "Salvo" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Salvos" }).click();
    await expect(page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" })).toBeVisible();

    // recarrega: o favorito precisa ter gravado no banco, nao so no estado do navegador.
    await page.reload();
    await expect(page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" })).toBeVisible();
  });

  test("o estado vazio muda o período pela URL ao clicar em Ver os últimos 30 dias", async ({ page }) => {
    await entrar(page, EMAIL);
    await page.goto(`/referencias?busca=${encodeURIComponent("assunto que nao existe em nenhum video")}`);

    await expect(page.getByRole("heading", { name: "Nada fora da curva com esses filtros" })).toBeVisible();
    await page.getByRole("button", { name: "Ver os últimos 30 dias" }).click();
    await expect(page).toHaveURL(/periodo=30/);
  });

  test("referências é escopado pela marca ativa: trocar de marca troca os vídeos", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL);

    // A marca ativa no primeiro login e a de criacao mais recente (marcaPadrao, sem cookie
    // ainda): Marca Um, criada depois da Dois neste fixture.
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) })).toBeVisible();

    await page.goto("/referencias");
    await expect(page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" })).toBeVisible();
    await expect(page.locator("article", { hasText: "o aparelho que corrigiu o sorriso" })).not.toBeVisible();

    await page.goto("/hoje");
    const pilula = page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) });
    await pilula.click();
    const folha = page.getByRole("dialog", { name: textosNav.suasMarcas });
    await expect(folha).toBeVisible();
    await folha.getByRole("button", { name: NOME_MARCA_DOIS }).click();
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) })).toBeVisible();
    // Espera a rede assentar antes de recarregar (mesmo achado de tema-livre.spec.ts: o nome
    // do botao muda otimista, antes da troca terminar de verdade no servidor).
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");

    await page.goto("/referencias");
    await expect(page.locator("article", { hasText: "o aparelho que corrigiu o sorriso" })).toBeVisible();
    await expect(page.locator("article", { hasText: "o produto que tira qualquer mancha do estofado" })).not.toBeVisible();
  });

  test("a rede principal sem vídeo no período mostra todas as redes e avisa (item 8, V12b)", async ({ page }) => {
    // O botão "Trocar de marca" só aparece na pílula do celular.
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL);

    // Marca Dois tem "tiktok" como rede principal, mas só vídeo de youtube no nicho (mesma
    // troca condicional do teste do embed, abaixo, para não depender da ordem dos testes).
    await garantirMarcaDoisAtiva(page);

    await page.goto("/referencias");
    await expect(page.getByText("Sem vídeo do TikTok neste período; mostrando as outras redes.")).toBeVisible();
    await expect(page.locator("article", { hasText: "o aparelho que corrigiu o sorriso" })).toBeVisible();
  });

  test("abrir Ver detalhes de um vídeo do YouTube carrega o iframe (V9d, item 0b: o observador dispara dentro da folha)", async ({
    page,
  }) => {
    // O botão "Trocar de marca" só aparece na pílula do celular.
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL);

    // O vídeo de teste do embed está na Marca Dois (nichoDois). A marca ativa no login novo
    // segue "o acesso mais recente" (`src/lib/marca-ativa.ts`), então pode já ser a Dois, se o
    // teste anterior (que também troca de marca) rodou antes deste; troca só se precisar.
    await garantirMarcaDoisAtiva(page);

    await page.goto("/referencias");
    const cartao = page.locator("article", { hasText: "video de teste do embed dentro da folha" });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();

    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(folha).toBeVisible();
    await expect(folha.locator("iframe")).toHaveAttribute("src", /youtube\.com\/embed\/jNQXAC9IVRw/);
  });
});

/**
 * Item 8, V12b: "Limpar os filtros" precisa limpar de verdade, mesmo com uma
 * rede principal escolhida (antes, a próxima navegação que não mexesse em
 * plataforma reaplicava o padrão, porque `montarUrl` omitia o parâmetro em
 * vez de mandar `plataforma=todas`). Fixture própria, separada da marca
 * usada no resto do arquivo: aqui a rede principal precisa ter vídeo (para
 * "Limpar" ter o que ampliar), o oposto do teste acima.
 */
test.describe("/referencias, 'Limpar os filtros' com rede principal (item 8, V12b)", () => {
  const EMAIL_LIMPAR = "e2e-referencias-limpar@exemplo.teste";

  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4, mesmo padrão do describe principal
    // deste arquivo): se a pessoa de teste já existe, a primeira passada já criou tudo o que ela precisa.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-referencias-limpar"));
    if (jaExiste) return;

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-referencias-limpar", nome: "[teste] Referências Limpar" })
      .returning();

    await db().insert(user).values({ id: "e2e-referencias-limpar", name: "[teste] Referências Limpar", email: EMAIL_LIMPAR });
    await db()
      .insert(account)
      .values({
        id: "e2e-referencias-limpar-credential",
        issuer: "local:credential",
        accountId: "e2e-referencias-limpar",
        providerId: "credential",
        userId: "e2e-referencias-limpar",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-referencias-limpar", aceitouTermosEm: new Date() });

    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-referencias-limpar", nome: "[teste] Referências Limpar", nichoId: nicho.id, redePrincipal: "instagram" })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-referencias-limpar", clienteId: cliente.id, papel: "dono" });
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

    const [contaInstagram] = await db()
      .insert(contas)
      .values({
        plataforma: "instagram",
        handle: "@e2e-referencias-limpar-instagram",
        nome: "[teste] Casa em Ordem",
        nichoId: nicho.id,
        medianaViews: "5000",
        medianaOrigem: "conta",
      })
      .returning();
    const [contaTiktok] = await db()
      .insert(contas)
      .values({
        plataforma: "tiktok",
        handle: "@e2e-referencias-limpar-tiktok",
        nome: "[teste] Limpeza da Ana",
        nichoId: nicho.id,
        medianaViews: "8000",
        medianaOrigem: "conta",
      })
      .returning();

    await db()
      .insert(videos)
      .values([
        {
          plataforma: "instagram",
          idExterno: "e2e-referencias-limpar-instagram-1",
          url: "https://exemplo.invalido/e2e-referencias-limpar-instagram-1",
          nichoId: nicho.id,
          contaId: contaInstagram.id,
          titulo: "o produto que tira qualquer mancha do estofado",
          views: 120000,
          foraDaCurva: "24.0",
          velocidade: "4000",
          idioma: "pt",
          publicadoEm: new Date(),
          analise: analiseExemplo("mancha em estofado") as never,
        },
        {
          plataforma: "tiktok",
          idExterno: "e2e-referencias-limpar-tiktok-1",
          url: "https://exemplo.invalido/e2e-referencias-limpar-tiktok-1",
          nichoId: nicho.id,
          contaId: contaTiktok.id,
          titulo: "organizando o guarda roupa em dez minutos",
          views: 40000,
          foraDaCurva: "5.0",
          velocidade: "900",
          idioma: "pt",
          publicadoEm: new Date(),
          analise: analiseExemplo("organizacao do guarda roupa", "podcast") as never,
        },
      ]);
  });

  test("'Limpar os filtros' na folha continua limpo depois de trocar o período", async ({ page }) => {
    await entrar(page, EMAIL_LIMPAR);

    // A rede principal (instagram) prefiltra de saída: só o vídeo de instagram aparece.
    await page.goto("/referencias");
    await expect(page.getByText("1 vídeo fora da curva nos últimos 7 dias")).toBeVisible();
    await expect(page.locator("article", { hasText: "mancha do estofado" })).toBeVisible();
    await expect(page.locator("article", { hasText: "guarda roupa" })).not.toBeVisible();

    await page.getByRole("button", { name: "Filtrar" }).click();
    const folha = page.getByRole("dialog", { name: "Filtrar" });
    await expect(folha).toBeVisible();
    await folha.getByRole("button", { name: "Limpar" }).click();

    await expect(folha).not.toBeVisible();
    await expect(page).toHaveURL(/plataforma=todas/);
    await expect(page.getByText("2 vídeos fora da curva nos últimos 7 dias")).toBeVisible();
    await expect(page.locator("article", { hasText: "guarda roupa" })).toBeVisible();

    // Troca o período sem tocar em plataforma: antes desta correção, isto reaplicava o
    // prefiltro da rede principal (o parâmetro sumia da URL). Continua nos dois vídeos.
    await page.getByLabel("Período").selectOption("30");
    await expect(page).toHaveURL(/plataforma=todas/);
    await expect(page).toHaveURL(/periodo=30/);
    await expect(page.getByText("2 vídeos fora da curva nos últimos 30 dias")).toBeVisible();
    await expect(page.locator("article", { hasText: "guarda roupa" })).toBeVisible();
    await expect(page.locator("article", { hasText: "mancha do estofado" })).toBeVisible();
  });
});
