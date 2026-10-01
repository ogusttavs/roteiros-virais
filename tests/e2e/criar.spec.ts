/**
 * `/criar`, a oficina (E39a, design v2, `Criar.dc.html`, estado `inicio`): os quatro caminhos
 * sempre visíveis, nenhum escondido atrás de uma porta que precisa abrir primeiro. Cobre o que
 * `hoje-portas.spec.ts` cobria antes da reforma (a tela em si, a pergunta da rede principal),
 * reorganizado para onde esse conteúdo mora agora: `/criar` e `/criar/temas`.
 *
 * Mesma lição de `temas-do-dia.spec.ts` e `momento.spec.ts`: grava tema e briefing direto no
 * banco, nunca chama `src/ia` no corpo do teste.
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
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-criar@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("/criar, os quatro caminhos", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-criar"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-criar", nome: "[teste] Criar" }).returning();

    await db().insert(user).values({ id: "e2e-criar", name: "[teste] Criar", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-criar-credential",
        issuer: "local:credential",
        accountId: "e2e-criar",
        providerId: "credential",
        userId: "e2e-criar",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-criar", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-criar", nome: "[teste] Criar", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-criar", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofá de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicílio",
        referencias: [],
      },
    });

    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("mostra os quatro caminhos e o aviso de que tudo fica marcado em Hoje", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar");

    await expect(page.getByRole("heading", { name: "Criar roteiros" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Os temas de hoje" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Um assunto seu" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Contar o momento" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Planejar os próximos dias" })).toBeVisible();
    await expect(page.getByText("Tudo o que você cria fica marcado no dia, em Hoje.")).toBeVisible();
  });

  test("'Os temas de hoje' leva para /criar/temas, com a pergunta da rede e os três temas", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Os temas de hoje" }).click();

    await expect(page).toHaveURL(/\/criar\/temas/);
    await expect(page.getByText("Onde você posta mais?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Instagram", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 2" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema de teste 3" })).toBeVisible();
  });

  test("'Um assunto seu' leva para /criar/tema-livre", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Um assunto seu" }).click();

    await expect(page).toHaveURL(/\/criar\/tema-livre/);
    await expect(page.getByRole("heading", { name: "Sobre o que você quer falar?" })).toBeVisible();
  });

  test("'Contar o momento' abre a folha Gravar agora direto, sem passar por outra tela", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Contar o momento" }).click();

    await expect(page.getByRole("dialog", { name: "Gravar agora" })).toBeVisible();
    // A pergunta "para quando é" mora dentro da própria folha (dúvida 10): sem data, sem rota nova.
    await expect(page).toHaveURL(/\/criar$/);
  });

  test("'Planejar os próximos dias' abre a folha de planejar direto", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar");
    await page.getByRole("button", { name: "Planejar os próximos dias" }).click();

    await expect(page.getByRole("dialog", { name: "Planejar os próximos dias" })).toBeVisible();
  });

  test("rota antiga /hoje/tema-livre continua abrindo, com a consulta preservada", async ({ page }) => {
    await entrar(page);
    await page.goto("/hoje/tema-livre?tema=mancha+no+sofa");

    await expect(page).toHaveURL(/\/criar\/tema-livre\?tema=/);
    await expect(page.getByLabel("Sobre o que você quer falar?")).toHaveValue("mancha no sofa");
  });

  test("rota antiga /hoje/objetivo continua abrindo, com a consulta preservada", async ({ page }) => {
    await entrar(page);
    await page.goto("/hoje/objetivo?tema=0");

    await expect(page).toHaveURL(/\/criar\/objetivo\?tema=0/);
    await expect(page.getByText("tema de teste 1")).toBeVisible();
  });
});
