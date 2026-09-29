/**
 * V12, "o Hoje em duas portas" (definição de pronto do `PROXIMO.md`): a
 * pergunta "O que você quer gravar agora?", as duas portas até o roteiro, a
 * rede principal (primeira vez, trocável, o Voltar do aparelho fecha a
 * porta). `plano.spec.ts` já cobre a porta Story até "Planejar os próximos
 * dias"; `momento.spec.ts`, `roteiro.spec.ts` e `sem-limite-diario.spec.ts`
 * já cobrem a porta Reels até o roteiro por outros caminhos. Este arquivo é
 * sobre a tela em si: a pergunta, as duas portas, e a rede principal.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

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
const EMAIL = "e2e-hoje-portas@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("V12, o Hoje em duas portas", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-hoje-portas", nome: "[teste] Hoje portas" }).returning();

    await db().insert(user).values({ id: "e2e-hoje-portas", name: "[teste] Hoje portas", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-hoje-portas-credential",
        issuer: "local:credential",
        accountId: "e2e-hoje-portas",
        providerId: "credential",
        userId: "e2e-hoje-portas",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-hoje-portas", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-hoje-portas", nome: "[teste] Hoje portas", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-hoje-portas", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofa de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicilio",
        referencias: [],
      },
    });

    const temas: TemaDoDia[] = [
      { titulo: "tema da porta 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema da porta 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema da porta 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("sem porta escolhida, só a pergunta e as duas portas; escolher fecha só no Voltar do aparelho", async ({ page }) => {
    await entrar(page);

    await expect(page.getByText("O que você quer gravar agora?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema da porta 1" })).toHaveCount(0);
    const portaReels = page.getByRole("button", { name: "Reels ou vídeo curto" });
    const portaStory = page.getByRole("button", { name: "Story" });
    await expect(portaReels).toBeVisible();
    await expect(portaStory).toBeVisible();

    await portaReels.click();
    await expect(page).toHaveURL(/porta=reels/);
    await expect(page.getByRole("heading", { name: "tema da porta 1" })).toBeVisible();
    await expect(page.getByText("O que você quer gravar agora?")).toHaveCount(0);

    // O Voltar do aparelho fecha a porta, não sai do Hoje (item 2 do PROXIMO.md).
    await page.goBack();
    await expect(page).toHaveURL(/\/hoje$/);
    await expect(page.getByText("O que você quer gravar agora?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema da porta 1" })).toHaveCount(0);
  });

  test("a rede principal: pergunta na primeira vez, grava, e troca quando quiser", async ({ page }) => {
    await entrar(page);
    await page.getByRole("button", { name: "Reels ou vídeo curto" }).click();

    // Primeira vez: a pergunta aparece, nenhum chip marcado.
    await expect(page.getByText("Onde você posta mais?")).toBeVisible();
    const chipInstagram = page.getByRole("button", { name: "Instagram", exact: true });
    await expect(chipInstagram).toHaveAttribute("aria-pressed", "false");
    // `escolherRede` (HojeTela.tsx) grava sem esperar (otimista, sem tela de carregando); espera a
    // resposta do servidor antes de recarregar, senão o `reload` pode chegar primeiro que a gravação.
    const salvouRede = page.waitForResponse((resposta) => resposta.request().method() === "POST" && resposta.ok());
    await chipInstagram.click();
    await expect(chipInstagram).toHaveAttribute("aria-pressed", "true");
    await salvouRede;

    // Recarrega (a URL guarda `?porta=reels`, a porta continua aberta): a pergunta não volta, mas o
    // chip continua marcado (gravado na marca).
    await page.reload();
    await expect(page.getByText("Onde você posta mais?")).toHaveCount(0);
    await expect(page.getByText("As referências e os exemplos vêm dessa rede. Dá para trocar quando quiser.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Instagram", exact: true })).toHaveAttribute("aria-pressed", "true");

    // Trocável a qualquer hora.
    await page.getByRole("button", { name: "TikTok", exact: true }).click();
    await expect(page.getByRole("button", { name: "TikTok", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Instagram", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("a porta Story: 'Gravar agora' já chega com o formato em Story, até o roteiro", async ({ page }) => {
    await entrar(page);
    await page.getByRole("button", { name: "Story" }).click();
    await expect(page.getByText("Story", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Gravar agora" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    const controleFormato = folha.getByRole("tablist", { name: "Formato" });
    await expect(controleFormato.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");

    await folha.getByLabel("Onde você está").fill("na loja");
    await folha.getByLabel("O que está acontecendo").fill("mostrando um produto novo");
    await folha.getByLabel("O que dá para mostrar").fill("a embalagem do produto");
    // "Mais gente me conhecer" sugeriria Reels sozinho (`story.spec.ts`); aqui o formato já chegou
    // preso pela porta Story, então continua em Story mesmo depois de escolher esse objetivo.
    await folha.getByRole("radio", { name: /mais gente me conhecer/i }).click();
    await expect(controleFormato.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
  });
});
