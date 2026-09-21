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

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-referencias@exemplo.teste";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
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
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

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
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-referencias", nome: "[teste] Referencias", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-referencias", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-referencias", aceitouTermosEm: new Date() });

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
        handle: "@e2e-referencias-instagram",
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
        handle: "@e2e-referencias-tiktok",
        nome: "[teste] Limpeza da Ana",
        nichoId: nicho.id,
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
        nichoId: nicho.id,
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
        nichoId: nicho.id,
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
});
