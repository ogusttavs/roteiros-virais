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
import { account, briefings, clientes, nichos, temasDia, user, videos, type TemaDoDia } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-roteiro@exemplo.teste";

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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
      .values({ usuarioId: "e2e-roteiro", nome: "[teste] Roteiro", nichoId: nicho.id })
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
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeIso(), temas });
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
    await cartaoDoTema.locator("..").getByRole("button", { name: "quero esse" }).click();

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

    await page.getByRole("button", { name: "gravei", exact: true }).click();
    await expect(page.getByText(/gravado às/)).toBeVisible();
  });
});
