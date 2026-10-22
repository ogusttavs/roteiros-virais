/**
 * "Para que o vídeo parece feito" (E49 PR 2): no Criar, escolher uma ficha mostra "Exemplos que fazem isso" (e o estado "ainda não temos exemplos" quando o setor não tem);
 * em Referências, a pílula "Parece feito para", o selo no cartão, a contagem e o estado vazio com "Ver todos".
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contas, membrosMarca, nichos, preferenciasUsuario, temasDia, user, videos, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const ID = "e2e-exemplos-ficha";
const EMAIL = `${ID}@exemplo.teste`;
/** Um PNG de um pixel, em data URI: a capa que carrega. */
const CAPA_DE_TESTE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("exemplos por ficha", () => {
  test.beforeAll(async () => {
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID));
    if (jaExiste) return;
    const [nicho] = await db().insert(nichos).values({ slug: ID, nome: "[teste] Exemplos" }).returning();
    await db().insert(user).values({ id: ID, name: "[teste] Exemplos", email: EMAIL });
    await db().insert(account).values({ id: `${ID}-credential`, issuer: "local:credential", accountId: ID, providerId: "credential", userId: ID, password: await hashPassword(SENHA) });
    await db().insert(preferenciasUsuario).values({ usuarioId: ID, aceitouTermosEm: new Date() });
    const [marca] = await db().insert(clientes).values({ usuarioId: ID, nome: "[teste] Exemplos", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: ID, clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "lavagem de estofados", preco: "sofá por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });
    const temas: TemaDoDia[] = [{ titulo: "tema de teste 1", descricao: "d1", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" }];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
    // Um vídeo do setor que parece feito para "Que guardem"; nenhum para "Que comentem".
    const [conta] = await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-exemplos-ficha", nichoId: nicho.id }).returning();
    await db().insert(videos).values({
      plataforma: "tiktok",
      idExterno: "exemplos-ficha-1",
      url: "https://exemplo.invalido/exemplos-ficha-1",
      // A legenda do post traz as hashtags; o exemplo do Criar mostra o título sem elas. A capa é uma imagem de verdade (um pixel), para o teste ver a imagem e não o retângulo neutro.
      titulo: "o passo a passo que todo mundo salva #limpeza #dica",
      capaUrl: CAPA_DE_TESTE,
      contaId: conta.id,
      nichoId: nicho.id,
      views: 120_000,
      publicadoEm: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      foraDaCurva: "9",
      idioma: "pt",
      analise: { assunto: "limpar estofado", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" } as never,
      formatoCatalogo: "passo_a_passo",
      fichaCatalogo: "guardem",
      serveDeModelo: true,
      tipoConteudo: "original",
    });
  });

  test("Criar: a ficha escolhida fica sozinha com os exemplos; sem exemplos, o estado diz; as cinco voltam", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    const grupo = page.locator("[data-fichas]");
    await expect(grupo.getByRole("radio")).toHaveCount(5);
    // A recomendada já marcada não fecha a lista nem pede exemplos.
    await expect(page.locator("[data-exemplos]")).toHaveCount(0);

    await grupo.getByRole("radio", { name: /Que guardem para depois/ }).click();
    await expect(grupo.getByRole("radio")).toHaveCount(1);
    const exemplos = page.locator('[data-exemplos="com"]');
    await expect(exemplos).toBeVisible();
    await expect(exemplos).toContainText("Exemplos que fazem isso");
    await expect(exemplos.locator("[data-exemplo]")).toHaveCount(1);
    await expect(exemplos).toContainText("o passo a passo que todo mundo salva");
    // O link leva o caminho de volta (o passo do objetivo, com os parâmetros de agora), para Referências trazer a pessoa de volta ao roteiro.
    await expect(exemplos.getByRole("link", { name: "Ver mais em Referências" })).toHaveAttribute("href", `/referencias?feitoPara=guardem&periodo=90&voltar=${encodeURIComponent("/criar/objetivo?tema=0")}`);

    await page.getByRole("button", { name: "Ver as cinco de novo" }).click();
    await expect(grupo.getByRole("radio")).toHaveCount(5);
    await grupo.getByRole("radio", { name: /Que comentem/ }).click();
    const vazio = page.locator('[data-exemplos="sem"]');
    await expect(vazio).toBeVisible();
    await expect(vazio).toContainText("Ainda não temos exemplos deste tipo no seu setor");
    // Sem exemplos, o roteiro sai do mesmo jeito.
    await expect(page.getByRole("button", { name: "escrever o roteiro" })).toBeEnabled();
  });

  test("Criar: o exemplo mostra a capa, o título sem hashtags, a conta e o selo; o toque abre a prévia do vídeo na própria tela e fecha sem sair do passo", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    await page.locator("[data-fichas]").getByRole("radio", { name: /Que guardem para depois/ }).click();
    const exemplo = page.locator("[data-exemplo]").first();
    await expect(exemplo).toBeVisible();
    // A capa é a imagem do vídeo (a mesma do cartão de Referências), não o retângulo neutro.
    await expect(exemplo.locator('[data-capa="imagem"] img')).toHaveCount(1);
    await expect(exemplo).toContainText("o passo a passo que todo mundo salva");
    await expect(exemplo).not.toContainText("#limpeza");
    await expect(exemplo).toContainText("conta-exemplos-ficha");
    await expect(exemplo).toContainText("TikTok");
    await expect(exemplo.getByText("Passo a passo", { exact: true })).toBeVisible();

    await exemplo.getByRole("button").click();
    const previa = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(previa).toBeVisible();
    await expect(previa.getByRole("link", { name: "Abrir na plataforma" })).toBeVisible();
    // Só ver: sem salvar nem "usar como referência".
    await expect(previa.getByRole("button", { name: /^salvar$/i })).toHaveCount(0);
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0/);
    await previa.getByRole("button", { name: "Voltar para o roteiro" }).click();
    await expect(previa).toHaveCount(0);
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0/);
    // O Voltar do aparelho com a prévia aberta fecha só a prévia.
    await exemplo.getByRole("button").click();
    await expect(previa).toBeVisible();
    await page.goBack();
    await expect(previa).toHaveCount(0);
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0/);
  });

  test("Criar para Referências e de volta: o que a pessoa escolheu continua lá, pelo botão da tela e pelo Voltar do navegador", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    const grupo = page.locator("[data-fichas]");
    await grupo.getByRole("radio", { name: /Que guardem para depois/ }).click();
    await page.getByLabel(/O que este vídeo precisa comunicar/).fill("o horário de sábado mudou");
    await page.getByRole("link", { name: "Ver mais em Referências" }).click();
    await expect(page).toHaveURL(/\/referencias\?.*voltar=/);
    // O botão fixo no alto, que só existe com o caminho de volta.
    const voltar = page.locator("[data-voltar-para-o-roteiro]").getByRole("link", { name: "Voltar para o seu roteiro" });
    await expect(voltar).toBeVisible();
    await voltar.click();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0$/);
    await expect(grupo.getByRole("radio")).toHaveCount(1);
    await expect(grupo.getByRole("radio", { name: /Que guardem para depois/ })).toBeChecked();
    await expect(page.getByLabel(/O que este vídeo precisa comunicar/)).toHaveValue("o horário de sábado mudou");

    // E pelo Voltar do navegador: vai a Referências de novo e volta com o histórico.
    await page.getByRole("link", { name: "Ver mais em Referências" }).click();
    await expect(page).toHaveURL(/\/referencias/);
    await page.goBack();
    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0$/);
    await expect(grupo.getByRole("radio")).toHaveCount(1);
    await expect(page.getByLabel(/O que este vídeo precisa comunicar/)).toHaveValue("o horário de sábado mudou");
  });

  test("Referências: o 'voltar' só vale com um caminho de /criar/ (outro endereço some, sem botão)", async ({ page }) => {
    await entrar(page);
    await page.goto(`/referencias?voltar=${encodeURIComponent("https://exemplo.com/criar/objetivo")}`);
    await expect(page.getByRole("heading", { name: "O que está funcionando no seu setor" })).toBeVisible();
    await expect(page.locator("[data-voltar-para-o-roteiro]")).toHaveCount(0);
    await page.goto(`/referencias?voltar=${encodeURIComponent("/hoje")}`);
    await expect(page.locator("[data-voltar-para-o-roteiro]")).toHaveCount(0);
  });

  test("Referências: a pílula, o selo no cartão, a contagem e o estado vazio com 'Ver todos'", async ({ page }) => {
    await entrar(page);
    await page.goto("/referencias?seg=todos&feitoPara=guardem");
    const cartao = page.locator("article").filter({ hasText: "o passo a passo que todo mundo salva" });
    await expect(cartao).toBeVisible();
    await expect(cartao.locator("[data-selo-feito-para]")).toHaveText("Que guardem");
    await expect(page.getByText(/parece feito para que guardem/)).toBeVisible();

    await page.goto("/referencias?seg=todos&feitoPara=comentem");
    await expect(page.getByRole("heading", { name: "Ainda não temos exemplos deste tipo no seu setor" })).toBeVisible();
    await expect(page.getByText(/Nenhum vídeo dos últimos 90 dias parece feito para que comentem/)).toBeVisible();
    await page.getByRole("button", { name: "Ver todos" }).click();
    await expect(page).not.toHaveURL(/feitoPara/);
    await expect(page.locator("article").filter({ hasText: "o passo a passo que todo mundo salva" })).toBeVisible();
  });

  test("Referências: a pílula escolhe a ficha e navega", async ({ page }) => {
    await entrar(page);
    await page.goto("/referencias?seg=todos");
    await page.locator("[data-pilula-feito-para]").getByRole("button").first().click();
    await page.getByRole("menuitemradio", { name: /Que guardem \(1\)/ }).click();
    await expect(page).toHaveURL(/feitoPara=guardem/);
    await expect(page.locator("article")).toHaveCount(1);
  });

  test("a falha esconde os exemplos mas dá para voltar às cinco fichas", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/objetivo?tema=0");
    const grupo = page.locator("[data-fichas]");
    await expect(grupo.getByRole("radio")).toHaveCount(5);
    // Toda Server Action (POST) falha a partir daqui.
    await page.route("**/criar/objetivo*", (rota) => (rota.request().method() === "POST" ? rota.abort() : rota.continue()));
    await grupo.getByRole("radio", { name: /Que guardem para depois/ }).click();
    await expect(grupo.getByRole("radio")).toHaveCount(1);
    await expect(page.locator("[data-exemplos]")).toHaveCount(0);
    await page.getByRole("button", { name: "Ver as cinco de novo" }).click();
    await expect(grupo.getByRole("radio")).toHaveCount(5);
  });
});
