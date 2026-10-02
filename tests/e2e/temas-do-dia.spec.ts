/**
 * `/hoje` e `/criar/tema-livre` pela tela (etapa 10, criterio de aceite do
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
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  temasDia,
  user,
  videos,
  type TemaDoDia,
} from "../../src/db/schema";
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
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-temas"));
    if (jaExiste) return;

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
      })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-temas", clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-temas", aceitouTermosEm: new Date() });

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

  /**
   * Achado do Gustavo em produção (01/10/2026, tablet deitado): os cartões de tema ficavam com uns
   * 200 px, o título quebrando de duas em duas palavras. O título de cada cartão tem de ter pelo
   * menos 190 px de largura (cartão de 16rem menos o respiro) do tablet deitado para cima.
   */
  for (const largura of [1024, 1180, 1280, 1920]) {
    test(`os cartoes de tema usam a largura, sem espremer o titulo, em ${largura}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await entrar(page, "e2e-temas@exemplo.teste");
      await expect(page).toHaveURL(/\/hoje/);
      await page.goto("/criar/temas");

      for (const nome of ["tema de teste 1", "tema de teste 2", "tema de teste 3"]) {
        const caixa = await page.getByRole("heading", { name: nome }).boundingBox();
        expect(caixa, `titulo "${nome}" sem caixa`).not.toBeNull();
        expect(caixa!.width, `titulo "${nome}" espremido em ${largura}px`).toBeGreaterThanOrEqual(190);
      }
      const semRolagem = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(semRolagem, "a tela nao pode rolar na horizontal").toBe(true);
    });
  }

  test("abre /hoje, ve os tres temas, avalia um tema livre e ve os cinco pilares", async ({ page }) => {
    await entrar(page, "e2e-temas@exemplo.teste");
    await expect(page).toHaveURL(/\/hoje/);

    // E39a: os temas do dia viraram a rota própria "/criar/temas".
    await page.goto("/criar/temas");

    await expect(page.getByRole("heading", { name: "tema de teste 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 2" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 3" })).toBeVisible();

    // "Escrever o meu assunto" só aparece no estado sem tema; com temas, o tema livre é a porta
    // "Um assunto seu" em /criar.
    await page.goto("/criar");
    await page.getByRole("button", { name: "Um assunto seu" }).click();
    await expect(page).toHaveURL(/\/criar\/tema-livre/);

    await page.getByLabel("Sobre o que você quer falar?").fill("clarear os dentes em casa");
    await page.getByRole("button", { name: "Avaliar o tema" }).click();

    await expect(page.getByText("Chance de viralizar")).toBeVisible();
    await expect(page.getByText("Chance de te chamarem para comprar")).toBeVisible();
    await expect(page.getByText("Encaixe com você")).toBeVisible();
    await expect(page.getByText("Novidade")).toBeVisible();
    await expect(page.getByText("Facilidade de gravar")).toBeVisible();
  });
});
