/**
 * O painel sem rede (V7, itens 4 a 10 do `PROXIMO.md`), contra `next start`
 * (build de producao: o service worker so se registra em producao,
 * `Conexao.tsx`).
 *
 * Duas familias de teste:
 *
 * 1. O roteiro do dia abre sem rede (itens 6 a 10): entra, abre o roteiro,
 *    abre o modo gravacao, `context.setOffline(true)`, recarrega, e confere
 *    o texto inteiro, a faixa, as acoes que precisam do servidor
 *    desabilitadas com o motivo, o modo gravacao funcionando, `/admin` e
 *    `/referencias` mostrando "Sem conexao" (nunca dado guardado de outra
 *    tela), a rede voltando. Mais os tres casos do item 7: o que foi
 *    guardado e apagado ao sair, ao trocar de marca e ao abrir o painel com
 *    outro usuario.
 * 2. A rede cai no meio de uma acao (item 4): o pedido do servidor e
 *    derrubado depois de o botao ter sido tocado (`cortarRedeNaProximaAcao`),
 *    e o teste confere a frase de rede, o texto digitado ainda na tela, a
 *    faixa, e que tentar de novo com a rede de volta funciona. Tres telas:
 *    avaliar tema, gerar roteiro e trocar de marca.
 *
 * Cada usuario tem um prefixo proprio ("e2e-semrede-*"), sem `resetarSchema`
 * (mesma licao de `roteiro.spec.ts` e `marcas.spec.ts`).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { inArray } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  temasDia,
  user,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { textosConexao } from "../../src/textos/conexao";
import { textosGravacao } from "../../src/textos/gravacao";
import { textosNav } from "../../src/textos/nav";
import { textosRoteiro } from "../../src/textos/roteiro";
import { textosTemaLivre } from "../../src/textos/tema-livre";

const SLUGS_NICHO = ["e2e-semrede-um", "e2e-semrede-dois"];
const IDS_USUARIO = ["e2e-semrede-a", "e2e-semrede-b", "e2e-semrede-c", "e2e-semrede-d"];

const SENHA = "ExemploSenha123";
const email = (id: string) => `${id}@exemplo.teste`;
const NOME_MARCA_UM = "[teste] Sem rede Um";
const NOME_MARCA_DOIS = "[teste] Sem rede Dois";
const TITULO_ROTEIRO = "o roteiro que precisa abrir no aviao";
const GANCHO = "todo mundo erra isso na hora de tirar mancha do sofa";

let roteiroUmId: number;

async function entrar(page: Page, id: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(id));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
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

function temaDoDia(titulo: string): TemaDoDia[] {
  return [
    {
      titulo,
      descricao: "descricao do tema",
      porQue: "esta subindo mais rapido que o normal da conta",
      evidencias: [],
      puxaPara: "alcance",
    },
  ];
}

const CONTEUDO: ConteudoRoteiro = {
  titulo: TITULO_ROTEIRO,
  duracaoS: 30,
  gancho: GANCHO,
  corpo: "explique o passo a passo na ordem certa, sem pular nenhuma etapa.",
  fechamento: "mostre o resultado limpo",
  chamadaFinal: "manda mensagem se quiser saber qual produto",
  cenas: [{ momento: "abertura", oQueFazer: "mostrar a mancha" }],
  ondeGravar: "na sala",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function criarUsuario(id: string, nome: string) {
  await db()
    .insert(user)
    .values({ id, name: `[teste] ${nome}`, email: email(id) });
  await db()
    .insert(account)
    .values({
      id: `${id}-credential`,
      issuer: "local:credential",
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(SENHA),
    });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
}

async function criarMarca(usuarioId: string, nome: string, nichoId: number) {
  const [marca] = await db().insert(clientes).values({ usuarioId, nome, nichoId }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({ clienteId: marca.id, ...briefingCompletoExemplo() });
  return marca;
}

/** Os pares "nome do cache | caminho" que o aparelho guardou das paginas do painel. */
async function paginasGuardadas(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const achados: string[] = [];
    for (const nome of await caches.keys()) {
      if (!nome.startsWith("roteiros-paginas:")) continue;
      const cache = await caches.open(nome);
      for (const pedido of await cache.keys()) achados.push(`${nome}|${new URL(pedido.url).pathname}`);
    }
    return achados;
  });
}

async function nomesDeCache(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

/** Espera o service worker guardar a pagina (ele busca de novo a pagina aberta, depois do registro). */
async function esperarGuardado(page: Page, caminho: string) {
  await expect
    .poll(async () => (await paginasGuardadas(page)).some((par) => par.endsWith(`|${caminho}`)), {
      message: `o aparelho deveria ter guardado ${caminho}`,
      timeout: 20_000,
    })
    .toBe(true);
}

/**
 * A rede cai no meio de uma acao (item 4): o pedido da Server Action chega a
 * sair do navegador, e so entao a rede some (`setOffline` mais o pedido
 * abortado), como acontece no metro. So o primeiro pedido e derrubado.
 */
async function cortarRedeNaProximaAcao(page: Page) {
  let cortou = false;
  await page.route("**/*", async (rota) => {
    const pedido = rota.request();
    if (!cortou && pedido.method() === "POST" && pedido.headers()["next-action"]) {
      cortou = true;
      await page.context().setOffline(true);
      await rota.abort("internetdisconnected");
      return;
    }
    await rota.continue();
  });
}

async function restaurarRede(page: Page) {
  await page.unroute("**/*");
  await page.context().setOffline(false);
}

const faixaSemConexao = (page: Page) => page.getByRole("status").filter({ hasText: textosConexao.faixa });

test.describe("painel sem rede", () => {
  test.beforeAll(async () => {
    // Idempotente (mesmo cuidado de `marcas.spec.ts`): apagar o usuario cascateia marcas e
    // preferencias, mas briefings, roteiros e temas do dia sao apagados a mao antes.
    const existentes = await db()
      .select({ id: clientes.id })
      .from(clientes)
      .where(inArray(clientes.usuarioId, IDS_USUARIO));
    const idsMarcas = existentes.map((m) => m.id);
    if (idsMarcas.length > 0) {
      await db().delete(roteiros).where(inArray(roteiros.clienteId, idsMarcas));
      await db().delete(briefings).where(inArray(briefings.clienteId, idsMarcas));
    }
    await db().delete(user).where(inArray(user.id, IDS_USUARIO));
    const nichosExistentes = await db().select({ id: nichos.id }).from(nichos).where(inArray(nichos.slug, SLUGS_NICHO));
    const idsNichos = nichosExistentes.map((n) => n.id);
    if (idsNichos.length > 0) await db().delete(temasDia).where(inArray(temasDia.nichoId, idsNichos));
    await db().delete(nichos).where(inArray(nichos.slug, SLUGS_NICHO));

    const [nichoUm] = await db()
      .insert(nichos)
      .values({ slug: "e2e-semrede-um", nome: "[teste] Sem rede Um" })
      .returning();
    const [nichoDois] = await db()
      .insert(nichos)
      .values({ slug: "e2e-semrede-dois", nome: "[teste] Sem rede Dois" })
      .returning();
    await db()
      .insert(temasDia)
      .values({ nichoId: nichoUm.id, data: hojeISO(), temas: temaDoDia("tema da marca um") });
    await db()
      .insert(temasDia)
      .values({ nichoId: nichoDois.id, data: hojeISO(), temas: temaDoDia("tema da marca dois") });

    // Pessoa A: duas marcas. A Dois primeiro e a Um por ultimo, porque a marca mais nova e a ativa no
    // primeiro login (`marcaPadrao`, `criadoEm desc`). So a Um tem roteiro do dia.
    await criarUsuario("e2e-semrede-a", "Sem rede A");
    await criarMarca("e2e-semrede-a", NOME_MARCA_DOIS, nichoDois.id);
    const marcaUm = await criarMarca("e2e-semrede-a", NOME_MARCA_UM, nichoUm.id);
    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: marcaUm.id,
        data: hojeISO(),
        tema: TITULO_ROTEIRO,
        origem: "sugerido",
        objetivo: "conversao",
        conteudo: CONTEUDO,
      })
      .returning();
    roteiroUmId = roteiro.id;

    // Pessoa B: outro usuario no mesmo aparelho (teste de "abrir com outro usuario").
    await criarUsuario("e2e-semrede-b", "Sem rede B");
    await criarMarca("e2e-semrede-b", "[teste] Sem rede B", nichoUm.id);

    // Pessoas C e D: uma marca cada, sem roteiro do dia (Objetivo e Tema livre geram um).
    await criarUsuario("e2e-semrede-c", "Sem rede C");
    await criarMarca("e2e-semrede-c", "[teste] Sem rede C", nichoDois.id);
    await criarUsuario("e2e-semrede-d", "Sem rede D");
    await criarMarca("e2e-semrede-d", "[teste] Sem rede D", nichoDois.id);
  });

  // A marca ativa no primeiro login e a de acesso mais recente (`marcaPadrao`); o teste de troca de marca
  // deixa a Dois como a mais recente, entao zera antes de cada teste para a Um ser sempre a ativa.
  test.beforeEach(async () => {
    await db().update(clientes).set({ ultimoAcessoEm: null }).where(inArray(clientes.usuarioId, IDS_USUARIO));
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("o roteiro do dia abre sem rede, com o modo gravacao, e as outras telas dizem que precisam de conexao", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-a");

    // Online: o Hoje, o roteiro e o modo gravacao dele (o worker guarda os tres).
    await esperarGuardado(page, "/hoje");
    await page.goto(`/roteiros/${roteiroUmId}`);
    await expect(page.getByRole("heading", { name: TITULO_ROTEIRO, level: 1 })).toBeVisible();
    await esperarGuardado(page, `/roteiros/${roteiroUmId}`);
    await esperarGuardado(page, `/roteiros/${roteiroUmId}/gravar`);
    await expect(faixaSemConexao(page)).toHaveCount(0);

    await page.getByRole("link", { name: textosRoteiro.modoGravacao }).first().click();
    await expect(page).toHaveURL(new RegExp(`/roteiros/${roteiroUmId}/gravar`));
    await page.getByRole("button", { name: textosGravacao.sair }).click();
    await expect(page).toHaveURL(new RegExp(`/roteiros/${roteiroUmId}$`));

    // Sem rede: recarrega o roteiro e o texto inteiro continua ali, com a faixa.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: TITULO_ROTEIRO, level: 1 })).toBeVisible();
    await expect(page.getByText(GANCHO)).toBeVisible();
    await expect(page.getByText("Onde gravar e o que mostrar")).toBeVisible();
    await expect(faixaSemConexao(page)).toBeVisible();

    // O que precisa do servidor fica desabilitado, com o motivo escrito.
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeDisabled();
    await expect(page.getByText(textosConexao.precisaDeConexao).first()).toBeVisible();

    // O modo gravacao abre sem rede (a navegacao interna cai na navegacao de documento, que o worker responde).
    await page.getByRole("link", { name: textosRoteiro.modoGravacao }).first().click();
    await expect(page).toHaveURL(new RegExp(`/roteiros/${roteiroUmId}/gravar`));
    await expect(page.getByText(GANCHO)).toBeVisible();
    // Passar de bloco e so leitura: funciona sem rede. Marcar que gravou precisa do servidor.
    await expect(page.getByRole("button", { name: textosGravacao.marcarGravei })).toBeDisabled();
    await expect(page.getByText(textosConexao.precisaDeConexao).first()).toBeVisible();

    // /admin e /referencias sem rede: a pagina de "Sem conexao", nunca dado guardado de outra tela.
    for (const caminho of ["/admin/clientes", "/referencias"]) {
      await page.goto(caminho);
      await expect(page.getByRole("heading", { name: "Sem conexão" })).toBeVisible();
      await expect(page.getByText(GANCHO)).toHaveCount(0);
      await expect(page.getByText(TITULO_ROTEIRO)).toHaveCount(0);
    }

    // A rede volta: a faixa some e as acoes voltam.
    await context.setOffline(false);
    await page.goto(`/roteiros/${roteiroUmId}`);
    await expect(page.getByRole("heading", { name: TITULO_ROTEIRO, level: 1 })).toBeVisible();
    await expect(faixaSemConexao(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeEnabled();
  });

  /**
   * Os arquivos do modo sem rede sao servidos SEM sessao (o middleware os deixa de fora pela lista
   * explicita, nunca por formato) e o service worker nunca fica em cache por tempo (item 6 e definicao de
   * pronto do PROXIMO.md). Um caminho parecido (`/sw.jsx`, `/offline.htm`) continua exigindo sessao.
   */
  test("o service worker, a pagina 'Sem conexao' e o manifesto saem sem sessao, e o worker nao fica em cache por tempo", async ({
    request,
  }) => {
    const worker = await request.get("/sw.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("javascript");
    expect(worker.headers()["cache-control"]).toContain("no-cache");

    const semConexao = await request.get("/offline.html");
    expect(semConexao.status()).toBe(200);
    expect(await semConexao.text()).toContain("Sem conexão");

    const manifesto = await request.get("/manifest.webmanifest");
    expect(manifesto.status()).toBe(200);
    const corpo = await manifesto.json();
    expect(corpo.display).toBe("standalone");
    expect(corpo.start_url).toBe("/hoje");
    expect(corpo.scope).toBe("/");

    for (const parecido of ["/sw.jsx", "/offline.htm", "/sw.js.map"]) {
      const resposta = await request.get(parecido, { maxRedirects: 0 });
      expect([307, 308, 404], `${parecido} nao pode ser servido sem sessao`).toContain(resposta.status());
      if (resposta.status() !== 404) expect(resposta.headers()["location"]).toContain("/entrar");
    }
  });

  test("a faixa aparece e some com a rede, sem recarregar a pagina", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-a");
    await page.goto(`/roteiros/${roteiroUmId}`);
    await expect(page.getByRole("heading", { name: TITULO_ROTEIRO, level: 1 })).toBeVisible();

    await context.setOffline(true);
    await expect(faixaSemConexao(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeDisabled();

    await context.setOffline(false);
    await expect(faixaSemConexao(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Já gravei", exact: true })).toBeEnabled();
  });

  test("sair apaga o que foi guardado, e sem rede o roteiro nao abre", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-a");
    await page.goto(`/roteiros/${roteiroUmId}`);
    await esperarGuardado(page, `/roteiros/${roteiroUmId}`);

    await page.goto("/conta");
    await page.getByRole("button", { name: "sair", exact: true }).click();
    await expect(page).toHaveURL(/\/entrar/);

    // Nada de dado de cliente ficou no aparelho (os arquivos do proprio aplicativo, sem dado de ninguem, ficam).
    expect(await paginasGuardadas(page)).toEqual([]);
    expect(await nomesDeCache(page)).not.toContain("roteiros-escopo");

    // Sem rede, tentar abrir o roteiro: nada guardado, so a pagina de "Sem conexao".
    await context.setOffline(true);
    await page.goto(`/roteiros/${roteiroUmId}`);
    await expect(page.getByRole("heading", { name: "Sem conexão" })).toBeVisible();
    await expect(page.getByText(GANCHO)).toHaveCount(0);
  });

  test("trocar de marca apaga o roteiro guardado da marca de antes", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-a");
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) })).toBeVisible();
    await page.goto(`/roteiros/${roteiroUmId}`);
    await esperarGuardado(page, `/roteiros/${roteiroUmId}`);

    // Troca para a Dois pela pilula (no Hoje, que tem a propria pilula).
    await page.goto("/hoje");
    await page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) }).click();
    await page
      .getByRole("dialog", { name: textosNav.suasMarcas })
      .getByRole("button", { name: NOME_MARCA_DOIS })
      .click();
    await expect(page.getByRole("heading", { name: "tema da marca dois" })).toBeVisible();

    // O escopo novo entra e o da Um sai: nenhuma pagina da Um continua guardada.
    await expect
      .poll(async () => (await paginasGuardadas(page)).filter((par) => par.endsWith(`/roteiros/${roteiroUmId}`)))
      .toEqual([]);

    // Sem rede, abrir o roteiro da Um: nada guardado.
    await context.setOffline(true);
    await page.goto(`/roteiros/${roteiroUmId}`);
    await expect(page.getByRole("heading", { name: "Sem conexão" })).toBeVisible();
    await expect(page.getByText(GANCHO)).toHaveCount(0);
  });

  test("abrir o painel com outro usuario apaga o que era do primeiro", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-a");
    await page.goto(`/roteiros/${roteiroUmId}`);
    await esperarGuardado(page, `/roteiros/${roteiroUmId}`);
    expect((await paginasGuardadas(page)).some((par) => par.includes("e2e-semrede-a"))).toBe(true);

    // A sessao some sem passar pelo botao Sair (venceu, ou outra pessoa pegou o aparelho): o que a
    // pessoa A guardou continua no aparelho ate a pessoa B abrir o painel.
    await context.clearCookies();
    await entrar(page, "e2e-semrede-b");

    await expect
      .poll(async () => (await paginasGuardadas(page)).filter((par) => par.includes("e2e-semrede-a")))
      .toEqual([]);
    expect((await nomesDeCache(page)).filter((nome) => nome.includes("e2e-semrede-a"))).toEqual([]);
  });

  test("avaliar o tema: a rede cai no meio, o texto continua, e tentar de novo funciona", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-d");
    await page.goto("/hoje/tema-livre");

    const assunto = "Uma cliente perguntou se o produto serve em sofa de camurca";
    const campo = page.getByRole("textbox");
    await campo.fill(assunto);

    await cortarRedeNaProximaAcao(page);
    await page.getByRole("button", { name: textosTemaLivre.avaliar }).click();

    await expect(page.getByText(textosConexao.falhaDeRede)).toBeVisible();
    await expect(faixaSemConexao(page)).toBeVisible();
    // O que foi digitado continua ali, para tentar de novo sem escrever outra vez.
    await expect(page.getByText(assunto)).toBeVisible();

    await restaurarRede(page);
    await expect(faixaSemConexao(page)).toHaveCount(0);
    await page.getByRole("button", { name: /tentar (de novo|outra vez)/i }).click();
    await expect(page.getByText(textosTemaLivre.tituloCompactoResultado)).toBeVisible({ timeout: 20_000 });
  });

  test("gerar o roteiro: a conexao cai no meio, a frase manda olhar o Historico, e tentar de novo funciona", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-c");
    await page.goto("/hoje/objetivo?tema=0");
    await page.getByRole("radio", { name: /gente me chamar para comprar/i }).click();

    await cortarRedeNaProximaAcao(page);
    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();

    await expect(page.getByText(textosConexao.conexaoCaiuNoMeio)).toBeVisible();
    await expect(faixaSemConexao(page)).toBeVisible();

    await restaurarRede(page);
    await expect(faixaSemConexao(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 20_000 });
  });

  test("trocar de marca: a rede cai no meio, a marca de antes continua, e tentar de novo funciona", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, "e2e-semrede-a");
    await page.goto("/historico");
    const pilulaUm = page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) });
    await pilulaUm.click();

    await cortarRedeNaProximaAcao(page);
    await page
      .getByRole("dialog", { name: textosNav.suasMarcas })
      .getByRole("button", { name: NOME_MARCA_DOIS })
      .click();

    await expect(page.getByText(textosConexao.trocarDeMarcaSemRede).filter({ visible: true })).toBeVisible();
    await expect(faixaSemConexao(page)).toBeVisible();
    // A marca de antes continua ativa.
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) })).toBeVisible();

    await restaurarRede(page);
    await expect(faixaSemConexao(page)).toHaveCount(0);
    await page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) }).click();
    await page
      .getByRole("dialog", { name: textosNav.suasMarcas })
      .getByRole("button", { name: NOME_MARCA_DOIS })
      .click();
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) })).toBeVisible();
  });
});
