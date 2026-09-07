/**
 * O fluxo inteiro pela tela (etapa 11, criterio de aceite do plano de
 * execucao): escolher tema, escolher objetivo, ver o roteiro, pedir outro
 * angulo, marcar gravei.
 *
 * Mesma licao de `temas-do-dia.spec.ts` e `briefing.spec.ts`: grava
 * briefing, video e tema do dia direto no banco (nunca chamando codigo de
 * `src/ia` no processo do Playwright), e deixa so a geracao do roteiro em
 * si passar pelo navegador, contra o `AI_PROVIDER=mock` do servidor
 * (`playwright.config.ts`). Cliente proprio ("e2e-roteiro"), sem
 * `resetarSchema` (etapa 11, ajuste 3 da revisao da etapa 10: o seed roda
 * uma vez so, no globalSetup). Usa o nicho "limpeza-e-organizacao-da-casa",
 * nao "dentistas": `temas_dia` tem uma unica linha por nicho e dia, e
 * `temas-do-dia.spec.ts` ja grava a linha de hoje para "dentistas".
 */
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  nichos,
  roteiros,
  temasDia,
  user,
  videos,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-roteiro@exemplo.teste";

let clienteId: number;

test.describe("roteiro pela tela", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id: "e2e-roteiro", name: "[teste] Roteiro", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-roteiro-credential",
        issuer: "local:credential",
        accountId: "e2e-roteiro",
        providerId: "credential",
        userId: "e2e-roteiro",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-roteiro", nome: "[teste] Roteiro", nichoId: nicho.id, aceitouTermosEm: new Date() })
      .returning();
    clienteId = cliente.id;

    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "kit tira-mancha para estofados",
            preco: "kit a partir de 89 reais",
            clienteIdeal: "mora em apartamento, tem filho pequeno ou animal de estimacao",
            medos: ["ja tentou um produto que estragou o tecido"],
            frasesDaFala: ['"uma direcao so, a gordura sai em vez de espalhar"'],
            proibicoes: [],
            cenasFilmaveis: ["cozinha", "sala com o sofa"],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "marca propria de produtos de limpeza",
          referencias: [],
        },
      });

    const [video] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-roteiro-mancha",
        url: "https://exemplo.invalido/e2e-roteiro-mancha",
        nichoId: nicho.id,
        titulo: "o produto que tira qualquer mancha do estofado",
        foraDaCurva: "6",
        publicadoEm: new Date(),
        analise: {
          assunto: "mancha em estofado",
          gancho: "esse produto tira qualquer mancha do estofado",
          estrutura: "mostra o produto agindo na mancha antes de explicar",
          fechamento: "resumo do que foi mostrado",
          chamadaFinal: "comenta se voce ja passou por isso",
          formato: "fala_para_camera",
          porQueFuncionou: "x",
        } as never,
      })
      .returning();

    const temas: TemaDoDia[] = [
      {
        titulo: "o erro que faz a mancha de vinho no sofa espalhar em vez de sair",
        descricao: "descricao do tema",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [video.id],
        puxaPara: "conversao",
      },
      {
        titulo: "tema de teste 2",
        descricao: "descricao do tema 2",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "engajamento",
      },
      {
        titulo: "tema de teste 3",
        descricao: "descricao do tema 3",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "alcance",
      },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("escolhe tema, escolhe objetivo, ve o roteiro, pede outro angulo, marca gravei", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);

    const cartaoDoTema = page.getByRole("heading", {
      name: "o erro que faz a mancha de vinho no sofa espalhar em vez de sair",
    });
    await expect(cartaoDoTema).toBeVisible();
    await cartaoDoTema.locator("../..").getByRole("button", { name: "quero esse" }).click();

    await expect(page).toHaveURL(/\/hoje\/objetivo/);
    await page.getByRole("radio", { name: /gente me chamar para comprar/i }).click();
    await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Onde gravar e o que mostrar")).toBeVisible();
    await expect(page.getByText("Como editar")).toBeVisible();

    const urlDaV1 = page.url();

    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "outro ângulo" }).click();
    await page.getByRole("button", { name: "escrever outra versão" }).click();

    await expect(page).not.toHaveURL(urlDaV1, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    await expect(page.getByText("versão 2 de 2")).toBeVisible();

    await page.getByRole("button", { name: "Já gravei", exact: true }).click();
    await expect(page.getByRole("button", { name: "Postei", exact: true })).toBeVisible();
  });

  /**
   * `PainelFlutuante` (acabamento do primeiro uso no iPad, item 1): o menu
   * dos três pontos nasce com `position: relative`, no fim da página, e no
   * iPad ninguém via. Este teste so confere que ele abre visível e com os
   * itens certos nas duas larguras, sem repetir o fluxo inteiro de gerar
   * roteiro; usa um roteiro próprio, gravado direto no banco.
   */
  for (const largura of [390, 1024]) {
    test(`o menu dos três pontos abre visível e fecha, em ${largura}px`, async ({ page }) => {
      const conteudo: ConteudoRoteiro = {
        titulo: "teste do menu",
        duracaoS: 30,
        gancho: "gancho de teste",
        corpo: "corpo de teste",
        fechamento: "fechamento de teste",
        chamadaFinal: "chamada final de teste",
        cenas: [{ momento: "abertura", oQueFazer: "mostrar o produto" }],
        ondeGravar: "na cozinha",
        edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: true,
      };
      const [roteiro] = await db()
        .insert(roteiros)
        .values({
          clienteId,
          data: hojeISO(),
          tema: conteudo.titulo,
          origem: "livre",
          objetivo: "conversao",
          conteudo,
        })
        .returning();

      await page.setViewportSize({ width: largura, height: 900 });
      await page.goto("/entrar");
      await page.getByLabel("E-mail").fill(EMAIL);
      await page.getByLabel("Senha").fill(SENHA);
      await page.getByRole("button", { name: "entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/hoje/);

      await page.goto(`/roteiros/${roteiro.id}`);
      const botaoMenu = page.getByRole("button", { name: "Mais opções" });
      await botaoMenu.click();

      const menu = page.getByRole("menu", { name: "Mais opções" });
      await expect(menu).toBeVisible();
      await expect(menu).toBeInViewport();
      await expect(page.getByRole("menuitem", { name: "outro ângulo" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "copiar texto" })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(botaoMenu).toBeFocused();
    });
  }
});
