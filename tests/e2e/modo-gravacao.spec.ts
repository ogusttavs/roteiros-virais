/**
 * V11, item 5: o fim do modo gravação (achado do Gustavo testando em
 * produção no celular, roteiro 9, Story, 18:21): no último bloco, "Próximo
 * bloco" ficava cinza e o único botão vivo era o redondo do certo, que só
 * mudava de cor; a pessoa marcou gravado às 18:23 sem "nada ter acontecido"
 * na tela. Agora o botão do meio vira "Terminei de gravar" no último bloco,
 * marca gravado e sai para o roteiro com o toast.
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
const EMAIL = "e2e-modo-gravacao@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** Gera um roteiro pelo caminho "Gravar agora" (não depende de tema do dia, mesma lição de `momento.spec.ts`). */
async function escreverRoteiroDeTeste(page: Page) {
  await page.goto("/hoje");
  // V12, item 3d: "Gravar agora" fica dentro da porta Reels.
  await page.getByRole("button", { name: "Reels ou vídeo curto" }).click();
  await page.getByRole("button", { name: "Gravar agora" }).click();
  const folha = page.getByRole("dialog", { name: "Gravar agora" });
  await expect(folha).toBeVisible();

  await folha.getByLabel("Onde você está").fill("na oficina");
  await folha.getByLabel("O que está acontecendo").fill("consertando uma peça na bancada");
  await folha.getByLabel("O que dá para mostrar").fill("a peça pronta no fim");
  await folha.getByRole("radio", { name: "Mais gente me conhecer" }).click();

  await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
  await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
}

test.describe("V11, item 5: o fim do modo gravação", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-modo-gravacao"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-modo-gravacao", nome: "[teste] Oficina" }).returning();

    await db().insert(user).values({ id: "e2e-modo-gravacao", name: "[teste] Oficina", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-modo-gravacao-credential",
        issuer: "local:credential",
        accountId: "e2e-modo-gravacao",
        providerId: "credential",
        userId: "e2e-modo-gravacao",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-modo-gravacao", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-modo-gravacao", nome: "[teste] Oficina", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-modo-gravacao", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "conserto de eletrodomésticos",
          preco: "revisão simples por R$ 90",
          clienteIdeal: "mora perto da oficina",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "conserta eletrodomésticos na oficina própria",
        referencias: [],
      },
    });

    // O botao "Gravar agora" fica dentro da porta Reels (V12, mesma licao de momento.spec.ts):
    // sem uma linha em temas_dia para hoje, /hoje nao renderiza HojeTela.
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("chega no último bloco, 'Terminei de gravar' marca e sai para o roteiro com o toast", async ({ page }) => {
    await entrar(page);
    await escreverRoteiroDeTeste(page);

    await page.getByRole("link", { name: "Modo gravação" }).first().click();
    await expect(page).toHaveURL(/\/roteiros\/\d+\/gravar/);

    // Reels: 4 blocos (abertura, meio, fechamento, chamada), 3 toques em "Próximo bloco" até o último.
    const proximoBloco = page.getByRole("button", { name: "Próximo bloco" });
    await expect(page.getByText("1 de 4")).toBeVisible();
    await proximoBloco.click();
    await proximoBloco.click();
    await proximoBloco.click();
    await expect(page.getByText("4 de 4")).toBeVisible();

    // No último bloco, "Próximo bloco" some (vira "Terminei de gravar") e o redondo do certo some junto.
    await expect(page.getByRole("button", { name: "Próximo bloco" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Marcar que gravei" })).toHaveCount(0);
    const terminar = page.getByRole("button", { name: "Terminei de gravar" });
    await expect(terminar).toBeVisible();

    await terminar.click();

    await expect(page).toHaveURL(/\/roteiros\/\d+$/);
    await expect(page.getByText("Gravado. Quando postar, marque em Histórico.")).toBeVisible();
    // O roteiro já veio gravado do servidor: a barra de ações troca "Já gravei" por "Postei".
    await expect(page.getByRole("button", { name: "Postei" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Já gravei" })).toHaveCount(0);
  });

  test("num bloco que não é o último, o botão redondo marca e mostra o toast, sem sair da tela", async ({ page }) => {
    await entrar(page);
    await escreverRoteiroDeTeste(page);

    await page.getByRole("link", { name: "Modo gravação" }).first().click();
    await expect(page).toHaveURL(/\/roteiros\/\d+\/gravar/);

    await page.getByRole("button", { name: "Marcar que gravei" }).click();
    await expect(page.getByText("Gravado. Quando postar, marque em Histórico.")).toBeVisible();
    // Continua no modo gravação: "Terminei de gravar" nunca aparece fora do último bloco.
    await expect(page).toHaveURL(/\/roteiros\/\d+\/gravar/);
    await expect(page.getByRole("button", { name: "Terminei de gravar" })).toHaveCount(0);
  });
});
