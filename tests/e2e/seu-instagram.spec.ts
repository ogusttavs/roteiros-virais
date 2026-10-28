/**
 * O cartão "Seu Instagram" da Conta (E19 PR 2), pelo servidor de verdade e contra a Meta SIMULADA (`tests/fixtures/meta-simulada.ts`: um servidor local que faz o papel do diálogo e da
 * Graph API; o aplicativo só fala com ele porque o `playwright.config.ts` sobe com `META_SIMULADOR_E2E`, que só vale com `MODO_E2E=1`). Nunca a Meta de verdade.
 *
 * Prova, pela tela: o convite e o aviso do grupo pequeno; o fluxo inteiro (botão, diálogo, volta, conta ligada, sem `?instagram=` no endereço); o acesso guardado cifrado e nunca na
 * página; o cancelamento e as demais frases da volta; várias contas e a escolha; desligar com confirmação; o problema guardado na conta; quem é só membro e o "ver como" sem botão.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contasConectadas, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";
import { textosLigacao } from "../../src/textos/conta-conectada";
import { CODIGO_SIMULADO, CONTA_PADRAO, iniciarMetaSimulada, TOKEN_CURTO_SIMULADO, TOKEN_LONGO_SIMULADO, type MetaSimulada } from "../fixtures/meta-simulada";

const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const DONO = "e2e-instagram-dono";
const DONO_EMAIL = "dono-e2e-instagram@exemplo.teste";
const MEMBRO = "e2e-instagram-membro";
const MEMBRO_EMAIL = "membro-e2e-instagram@exemplo.teste";
const t = textosLigacao.tela;

let meta: MetaSimulada;
let marca: number;

async function entrar(page: Page, email: string, destino: RegExp): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(destino);
}

async function criarPessoa(id: string, email: string, nome: string): Promise<void> {
  await db().delete(user).where(eq(user.id, id));
  await db().insert(user).values({ id, name: nome, email });
  await db().insert(account).values({ id: `${id}-c`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
}

function cartao(page: Page) {
  return page.getByTestId("seu-instagram");
}

test.describe("Seu Instagram, em Conta", () => {
  test.beforeAll(async () => {
    meta = await iniciarMetaSimulada(Number(process.env.PLAYWRIGHT_META_PORTA ?? 4747));
    const [nicho] = await db().select().from(nichos).limit(1);
    await criarPessoa(DONO, DONO_EMAIL, "Dona Instagram E2E");
    await criarPessoa(MEMBRO, MEMBRO_EMAIL, "Membro Instagram E2E");
    // Sem o perfil do Instagram preenchido: com várias contas, nenhuma "bate" sozinha e a pessoa precisa escolher.
    const [c] = await db().insert(clientes).values({ nome: "[teste e2e] Marca do Instagram", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" }).returning();
    marca = c.id;
    await db().insert(membrosMarca).values([
      { usuarioId: DONO, clienteId: marca, papel: "dono" },
      { usuarioId: MEMBRO, clienteId: marca, papel: "membro" },
    ]);
    await db().insert(briefings).values({ clienteId: marca, completo: true });
  });

  test.afterAll(async () => {
    await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marca));
    await meta.fechar();
  });

  test.beforeEach(async () => {
    await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marca));
    meta.cenario = {};
    meta.chamadas.length = 0;
  });

  test("sem ligação: o convite diz o que lemos e o que nunca fazemos, e avisa com calma que a ligação direta ainda abre para poucas pessoas", async ({ page }) => {
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/conta");
    const c = cartao(page);
    await expect(c).toHaveAttribute("data-estado", "sem-ligacao");
    await expect(c.getByRole("heading", { name: "Seu Instagram" })).toBeVisible();
    await expect(c).toContainText("o nome da sua conta");
    await expect(c).toContainText("ler as suas mensagens nem postar sem você pedir");
    await expect(c).toContainText("a ligação direta abre para todos quando a Meta aprovar o aplicativo");
    // E19b: a frase de quem tem conta pessoal (precisa trocar para profissional, de graça).
    await expect(c.locator('[data-parte="conta-profissional"]')).toContainText("precisa ser uma conta profissional");
    await expect(c.locator('[data-parte="conta-profissional"]')).toContainText("Mudar para conta profissional");
    await expect(c.getByRole("link", { name: "Ligar o meu Instagram" })).toHaveAttribute("href", "/api/meta/conectar");
    // Nada foi pedido à Meta só por abrir a tela.
    expect(meta.chamadas).toHaveLength(0);
  });

  test("o fluxo inteiro: o botão leva ao diálogo da Meta (simulada), a volta liga a conta, o acesso fica cifrado e nunca aparece na página", async ({ page }) => {
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/conta");
    await cartao(page).getByRole("link", { name: "Ligar o meu Instagram" }).click();

    // Voltou para Conta com a conta ligada, e o endereço perdeu o ?instagram=.
    await expect(page).toHaveURL(/\/conta$/);
    const c = cartao(page);
    await expect(c).toHaveAttribute("data-estado", "ligada");
    await expect(c.getByRole("status")).toContainText(textosLigacao.retorno.ligada);
    await expect(c.getByText("@casa.em.ordem.e2e")).toBeVisible();
    // Pela via do Instagram não há Página do Facebook no caminho: o cartão não mostra nome de Página.
    await expect(c).not.toContainText("Casa em Ordem E2E");
    await expect(c.getByText(/^\d\d\/\d\d\/\d{4}$/)).toBeVisible();
    await expect(c).toContainText(t.semLeitura);
    await expect(c.getByRole("button", { name: "Desligar" })).toBeVisible();
    await expect(c.getByRole("link")).toHaveCount(0);

    // O que o aplicativo pediu à Meta (E19b, Login do Instagram): o diálogo do Instagram com o fluxo de código e os escopos, a troca do código, a troca para o acesso longo e quem é a conta. Só no simulador.
    const dialogo = meta.chamadas.find((x) => x.caminho === "/instagram/oauth/authorize");
    expect(dialogo?.parametros).toMatchObject({
      response_type: "code",
      client_id: "1000000000000001",
      scope: "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish",
    });
    expect(dialogo?.parametros.config_id).toBeUndefined();
    const troca = meta.chamadas.find((x) => x.caminho === "/instagram/api/oauth/access_token");
    expect(troca).toMatchObject({ metodo: "POST", parametros: { code: CODIGO_SIMULADO, grant_type: "authorization_code", segredoEnviado: "sim" } });
    expect(meta.chamadas.some((x) => x.caminho === "/graph-ig/access_token" && x.parametros.grant_type === "ig_exchange_token")).toBe(true);
    expect(meta.chamadas.some((x) => x.caminho === "/graph-ig/me")).toBe(true);
    // Nada do caminho do Facebook: sem Página, sem diálogo do Facebook, sem `/me/accounts`.
    expect(meta.chamadas.some((x) => x.caminho.startsWith("/graph/") || x.caminho === "/dialog/oauth")).toBe(false);

    // No banco: a conta ativa da marca, com o acesso cifrado (nunca o texto do acesso).
    const linhas = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ contaId: CONTA_PADRAO.igId, nome: CONTA_PADRAO.username, estado: "ativa", conectadoPor: DONO, via: "instagram", paginaId: null, publicarLiberado: true });
    expect(linhas[0].tokenCifrado).not.toContain(TOKEN_LONGO_SIMULADO);
    expect(linhas[0].tokenCifrado).not.toContain(TOKEN_CURTO_SIMULADO);

    // Nem a página nem o texto dela têm o acesso, e recarregar não repete a frase da volta.
    await page.reload();
    const html = await page.content();
    expect(html).not.toContain(TOKEN_LONGO_SIMULADO);
    expect(html).not.toContain(TOKEN_CURTO_SIMULADO);
    await expect(cartao(page).getByRole("status")).toHaveCount(0);
    await expect(cartao(page).getByText("@casa.em.ordem.e2e")).toBeVisible();
  });

  test("desligar pede confirmação: 'Manter ligado' não desliga, 'Sim, desligar' apaga a ligação e o acesso", async ({ page }) => {
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/api/meta/conectar");
    await expect(cartao(page)).toHaveAttribute("data-estado", "ligada");

    await cartao(page).getByRole("button", { name: "Desligar" }).click();
    const pergunta = cartao(page).getByRole("alertdialog");
    await expect(pergunta).toContainText("A gente apaga o acesso que guardamos");
    await pergunta.getByRole("button", { name: "Manter ligado" }).click();
    await expect(cartao(page).getByRole("alertdialog")).toHaveCount(0);
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(1);

    await cartao(page).getByRole("button", { name: "Desligar" }).click();
    await cartao(page).getByRole("button", { name: "Sim, desligar" }).click();
    await expect(page.getByText("Instagram desligado.")).toBeVisible();
    await expect(cartao(page)).toHaveAttribute("data-estado", "sem-ligacao");
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(0);
  });

  test("quando a pessoa cancela no diálogo da Meta, nada é ligado e a frase é calma", async ({ page }) => {
    meta.cenario = { dialogo: "cancelar" };
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/api/meta/conectar");
    await expect(page).toHaveURL(/\/conta$/);
    await expect(cartao(page).getByRole("alert")).toContainText(textosLigacao.retorno.cancelou);
    await expect(cartao(page)).toHaveAttribute("data-estado", "sem-ligacao");
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(0);
    // O acesso nunca foi pedido: a pessoa cancelou antes.
    expect(meta.chamadas.some((x) => x.caminho.startsWith("/graph-ig/") || x.caminho.startsWith("/instagram/api/"))).toBe(false);
  });

  test("conta pessoal, permissão que ficou sem liberar e erro da Meta: cada um com a sua frase, e nada é ligado", async ({ page }) => {
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);

    meta.cenario = { tipoDeConta: "PERSONAL" };
    await page.goto("/api/meta/conectar");
    await expect(cartao(page).getByRole("alert")).toContainText("é uma conta pessoal");
    await expect(cartao(page).getByRole("alert")).toContainText("Mudar para conta profissional");
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(0);

    meta.cenario = { permissoesLiberadas: ["instagram_business_basic"] };
    await page.goto("/api/meta/conectar");
    await expect(cartao(page).getByRole("alert")).toContainText(textosLigacao.retorno.permissao);
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(0);

    meta.cenario = { erroEm: "usuario" };
    await page.goto("/api/meta/conectar");
    await expect(cartao(page).getByRole("alert")).toContainText(textosLigacao.retorno.falhou);
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(0);
  });

  test("o problema guardado na conta aparece com a frase pronta, e 'Ligar de novo' refaz o caminho", async ({ page }) => {
    await db().insert(contasConectadas).values({
      clienteId: marca,
      plataforma: "instagram",
      via: "instagram",
      contaId: CONTA_PADRAO.igId,
      nome: CONTA_PADRAO.username,
      paginaNome: CONTA_PADRAO.paginaNome,
      metaUsuarioId: "meta-pessoa-e2e",
      estado: "ativa",
      tokenCifrado: "v1.nao-importa",
      conectadoPor: DONO,
      conectadaEm: new Date("2026-10-01T12:00:00Z"),
      ultimaLeituraEm: new Date("2026-10-20T09:20:00Z"),
      erro: textosLigacao.erroDaConta.recusada,
      erroEm: new Date(),
    });
    await entrar(page, DONO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/conta");
    const c = cartao(page);
    await expect(c.getByRole("alert")).toContainText(textosLigacao.erroDaConta.recusada);
    await expect(c.getByText("20/10/2026 às 06:20")).toBeVisible();
    await expect(c.getByText("01/10/2026")).toBeVisible();
    await c.getByRole("link", { name: "Ligar de novo" }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(cartao(page).getByRole("status")).toContainText(textosLigacao.retorno.ligada);
    await expect(cartao(page).locator('[data-parte="erro-da-conta"]')).toHaveCount(0);
  });

  test("quem é só membro lê a conta ligada, sem botão; chegar ao /api/meta/conectar volta para Conta dizendo que só quem criou a conta liga", async ({ page }) => {
    await db().insert(contasConectadas).values({
      clienteId: marca,
      plataforma: "instagram",
      via: "instagram",
      contaId: CONTA_PADRAO.igId,
      nome: CONTA_PADRAO.username,
      metaUsuarioId: "meta-pessoa-e2e",
      estado: "ativa",
      tokenCifrado: "v1.nao-importa",
      conectadoPor: DONO,
      conectadaEm: new Date(),
    });
    await entrar(page, MEMBRO_EMAIL, /\/(hoje|comecar)/);
    await page.goto("/conta");
    const c = cartao(page);
    await expect(c.getByText("@casa.em.ordem.e2e")).toBeVisible();
    await expect(c.getByRole("button")).toHaveCount(0);
    await expect(c.getByRole("link")).toHaveCount(0);
    await expect(c).toContainText(t.soDono);

    await page.goto("/api/meta/conectar");
    await expect(page).toHaveURL(/\/conta$/);
    await expect(cartao(page).getByRole("alert")).toContainText(textosLigacao.retorno["sem-acesso"]);
    // A Meta nem foi chamada, e a conta continua como estava.
    expect(meta.chamadas).toHaveLength(0);
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(1);
  });

  test("no ver como nada do cartão é clicável, nem para a dona, e a rota de ligar recusa", async ({ page }) => {
    await db().insert(contasConectadas).values({
      clienteId: marca,
      plataforma: "instagram",
      via: "instagram",
      contaId: CONTA_PADRAO.igId,
      nome: CONTA_PADRAO.username,
      metaUsuarioId: "meta-pessoa-e2e",
      estado: "ativa",
      tokenCifrado: "v1.nao-importa",
      conectadoPor: DONO,
      conectadaEm: new Date(),
      erro: textosLigacao.erroDaConta.venceu,
    });
    await entrar(page, EMAIL_ADMIN, /\/admin\/?$/);
    await page.goto(`/admin/clientes/${marca}`);
    await page.locator('[data-bloco="acesso"]').getByRole("button", { name: "Ver o painel como Dona Instagram E2E" }).click();
    await page.getByRole("dialog", { name: "Ver o painel como" }).getByRole("button", { name: "Ver como Dona Instagram E2E" }).click();
    await expect(page).toHaveURL(/\/hoje/);

    await page.goto("/conta");
    const c = cartao(page);
    await expect(c.getByText("@casa.em.ordem.e2e")).toBeVisible();
    await expect(c.getByRole("alert")).toContainText(textosLigacao.erroDaConta.venceu);
    await expect(c.getByRole("button")).toHaveCount(0);
    await expect(c.getByRole("link")).toHaveCount(0);
    await expect(c).toContainText(t.verComo);

    // Mesmo digitando o endereço: o servidor recusa e nada muda.
    await page.goto("/api/meta/conectar");
    await expect(page).toHaveURL(/\/conta\?instagram=sem-acesso|\/conta$/);
    await expect(cartao(page).locator('[data-retorno="sem-acesso"]')).toContainText(textosLigacao.retorno["sem-acesso"]);
    expect(meta.chamadas).toHaveLength(0);
    expect(await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marca))).toHaveLength(1);
  });
});
