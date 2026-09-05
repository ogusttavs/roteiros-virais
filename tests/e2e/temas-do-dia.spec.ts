/**
 * `/hoje` e `/hoje/tema-livre` pela tela (etapa 10, criterio de aceite do
 * plano de execucao): cliente abre `/hoje`, ve os tres temas do dia, e
 * avalia um tema livre, vendo os cinco pilares.
 *
 * Este arquivo nunca chama `avaliarTema`, `temasParaCliente` nem qualquer
 * funcao que passe por `src/ia` direto no corpo do teste (mesma licao de
 * `briefing.spec.ts`): grava `temas_dia` e o briefing direto no banco, e
 * deixa so a avaliacao do tema livre passar pelo navegador, contra o
 * `AI_PROVIDER=mock` do servidor (`playwright.config.ts`).
 *
 * Sem `resetarSchema` proprio (etapa 11, ajuste 3 da revisao da etapa 10): o
 * seed roda uma vez so, no globalSetup; o cliente "e2e-temas" tem id
 * proprio, entao nao colide com o que outro arquivo de spec cria ou muda.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, nichos, temasDia, user, videos, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

test.describe("temas do dia pela tela", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    await db().insert(user).values({
      id: "e2e-temas",
      name: "[teste] Temas do dia",
      email: "e2e-temas@exemplo.teste",
    });
    await db()
      .insert(account)
      .values({
        id: "e2e-temas-credential",
        issuer: "local:credential",
        accountId: "e2e-temas",
        providerId: "credential",
        userId: "e2e-temas",
        password: await hashPassword(SENHA),
      });
    const [cliente] = await db()
      .insert(clientes)
      .values({
        usuarioId: "e2e-temas",
        nome: "[teste] Temas do dia",
        nichoId: nicho.id,
        aceitouTermosEm: new Date(),
      })
      .returning();

    await db()
      .insert(briefings)
      .values({
        clienteId: cliente.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "tratamento odontologico",
            preco: "consulta a partir de 150 reais",
            clienteIdeal: "familia da regiao",
            medos: ["medo de sentir dor"],
            frasesDaFala: ['"aqui a gente explica tudo antes"'],
            proibicoes: [],
            cenasFilmaveis: ["consultorio"],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "clinica odontologica de bairro",
          referencias: [],
        },
      });

    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-temas-clareamento",
        url: "https://exemplo.invalido/e2e-temas-clareamento",
        nichoId: nicho.id,
        titulo: "como clarear os dentes em casa",
        foraDaCurva: "6",
        publicadoEm: new Date(),
        analise: {
          assunto: "clareamento dental",
          gancho: "x",
          estrutura: "x",
          fechamento: "x",
          chamadaFinal: "x",
          formato: "fala_para_camera",
          porQueFuncionou: "x",
        } as never,
      });

    const temas: TemaDoDia[] = [
      {
        titulo: "tema de teste 1",
        descricao: "descricao do tema 1",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "alcance",
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
        puxaPara: "conversao",
      },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("abre /hoje, ve os tres temas, avalia um tema livre e ve os cinco pilares", async ({ page }) => {
    await entrar(page, "e2e-temas@exemplo.teste");
    await expect(page).toHaveURL(/\/hoje/);

    await expect(page.getByRole("heading", { name: "tema de teste 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 2" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 3" })).toBeVisible();

    await page.getByRole("button", { name: "quero falar de outra coisa" }).click();
    await expect(page).toHaveURL(/\/hoje\/tema-livre/);

    await page.getByLabel("Sobre o que você quer falar?").fill("clarear os dentes em casa");
    await page.getByRole("button", { name: "avaliar o tema" }).click();

    await expect(page.getByText("chance de viralizar")).toBeVisible();
    await expect(page.getByText("chance de gerar cliente")).toBeVisible();
    await expect(page.getByText("encaixe com você")).toBeVisible();
    await expect(page.getByText("novidade")).toBeVisible();
    await expect(page.getByText("facilidade de gravar")).toBeVisible();
  });
});
