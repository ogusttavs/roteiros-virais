/**
 * O "Quanto tempo?" da folha "Gravar agora" (E52, PR 4a): o vídeo longo do YouTube escolhido onde a pessoa conta o momento. Num ramo sem a medida dos vídeos longos (menos de três), a
 * opção aparece apagada com uma frase calma, ANTES de a pessoa escrever, e nunca como erro depois; num ramo com a medida, escolher o longo escreve um roteiro por capítulos. O Story e o vídeo
 * sem fala não têm a pergunta. Os vídeos são inventados (o repositório é público); a IA é o simulador.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, videos } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const DIA_MS = 24 * 60 * 60 * 1000;

function email(usuarioId: string): string {
  return `${usuarioId}@exemplo.teste`;
}

/** Uma marca com o seu ramo; `duracoesDosLongos` são os minutos dos vídeos longos que o ramo já tem (nenhum: o ramo sem a medida). */
async function criarMarca(usuarioId: string, duracoesDosLongos: number[]): Promise<number> {
  const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, usuarioId));
  if (jaExiste) {
    const [marca] = await db().select().from(clientes).where(eq(clientes.usuarioId, usuarioId));
    await db().delete(roteiros).where(eq(roteiros.clienteId, marca.id));
    return marca.id;
  }
  const [nicho] = await db().insert(nichos).values({ slug: `${usuarioId}-nicho`, nome: "[teste] Oficina", termos: [] }).returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Longo", email: email(usuarioId) });
  await db()
    .insert(account)
    .values({
      id: `${usuarioId}-credential`,
      issuer: "local:credential",
      accountId: usuarioId,
      providerId: "credential",
      userId: usuarioId,
      password: await hashPassword(SENHA),
    });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Longo ${usuarioId}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
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
  for (const [indice, minutos] of duracoesDosLongos.entries()) {
    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: `${usuarioId}-longo-${indice}`,
        url: `https://exemplo.invalido/${usuarioId}-longo-${indice}`,
        nichoId: nicho.id,
        titulo: `[exemplo] longo ${indice}`,
        views: 400_000,
        foraDaCurva: "3.000",
        duracaoS: minutos * 60,
        publicadoEm: new Date(Date.now() - 4 * DIA_MS),
        idioma: "pt",
      });
  }
  return marca.id;
}

async function entrar(page: Page, usuarioId: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email(usuarioId));
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

async function abrirGravarAgora(page: Page) {
  await page.goto("/criar");
  await page.getByRole("button", { name: "Contar o momento" }).click();
  const folha = page.getByRole("dialog", { name: "Gravar agora" });
  await expect(folha).toBeVisible();
  return folha;
}

test.describe("Gravar agora: o vídeo longo", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ramo sem a medida: a opção longa aparece apagada, com a frase calma, antes de escrever e sem parecer erro", async ({ page }) => {
    await criarMarca("e2e-longo-sem-medida", [8, 9]);
    await entrar(page, "e2e-longo-sem-medida");
    const folha = await abrirGravarAgora(page);

    await expect(folha.getByText("Quanto tempo?")).toBeVisible();
    await expect(folha.getByRole("button", { name: "Até 60 segundos" })).toHaveAttribute("aria-pressed", "true");
    const longa = folha.getByRole("button", { name: "Mais de 3 minutos, para o YouTube" });
    await expect(longa).toBeDisabled();
    await expect(folha.locator("[data-duracao-indisponivel]")).toContainText("Ainda não temos vídeos longos suficientes do seu ramo");
    // calmo: nenhum alerta
    await expect(folha.getByRole("alert")).toHaveCount(0);
  });

  test("ramo com a medida: escolher o vídeo longo escreve o roteiro por capítulos", async ({ page }) => {
    const marca = await criarMarca("e2e-longo-com-medida", [8, 10, 12]);
    await entrar(page, "e2e-longo-com-medida");
    const folha = await abrirGravarAgora(page);

    const longa = folha.getByRole("button", { name: "Mais de 3 minutos, para o YouTube" });
    await expect(longa).toBeEnabled();
    // no vídeo curto a linha "Pesquisar antes de escrever" está lá; com o longo ela some (o servidor recusa o longo com pesquisa)
    const linhaDePesquisa = folha.getByRole("button", { name: /Pesquisar antes de escrever/ });
    await expect(linhaDePesquisa).toHaveCount(1);
    // o rótulo comprido cabe dentro da folha, no celular: o chip termina antes da borda da própria folha (e a página não ganha rolagem de lado)
    const caixa = await longa.boundingBox();
    const caixaDaFolha = await folha.boundingBox();
    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(caixaDaFolha!.x + caixaDaFolha!.width - 8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await longa.click();
    await expect(longa).toHaveAttribute("aria-pressed", "true");
    // a medida do ramo dita: mediana de 10 minutos
    await expect(folha.getByText("No seu ramo, um vídeo longo costuma ter uns 10 minutos.")).toBeVisible();
    // o vídeo longo ainda não usa a pesquisa antes de escrever
    await expect(folha.locator("[data-duracao-sem-pesquisa]")).toBeVisible();
    await expect(linhaDePesquisa).toHaveCount(0);
    // e voltar ao curto traz a linha de volta
    await folha.getByRole("button", { name: "Até 60 segundos" }).click();
    await expect(linhaDePesquisa).toHaveCount(1);
    await longa.click();

    // sem tema recomendado nenhuma das cinco vem marcada: a pessoa escolhe o que o vídeo deve fazer
    await folha.getByRole("button", { name: "Que muita gente veja" }).click();
    await folha.getByLabel("Onde você está").fill("Na oficina, de manhã");
    await folha.getByLabel("O que está acontecendo").fill("Estou desmontando uma lavadora para mostrar o defeito");
    await folha.getByLabel("O que dá para mostrar").fill("A peça gasta e o antes e depois do conserto");
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marca));
    expect(roteiro.duracaoDoVideo).toBe("longo");
    expect(roteiro.conteudo.capitulos?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(roteiro.conteudo.capitulos?.[0].inicioS).toBe(0);
  });

  test("escolheu o longo e trocou para Story: o roteiro sai Story e curto, e voltar a Vídeo retoma o longo", async ({ page }) => {
    const marca = await criarMarca("e2e-longo-troca-story", [8, 10, 12]);
    await entrar(page, "e2e-longo-troca-story");
    const folha = await abrirGravarAgora(page);

    const longa = folha.getByRole("button", { name: "Mais de 3 minutos, para o YouTube" });
    await longa.click();
    await folha.getByRole("tab", { name: "Story" }).click();
    await expect(folha.getByText("Quanto tempo?")).toHaveCount(0);
    await folha.getByRole("tab", { name: "Vídeo" }).click();
    await expect(longa).toHaveAttribute("aria-pressed", "true");
    await folha.getByRole("tab", { name: "Story" }).click();

    await folha.getByLabel("Onde você está").fill("Na oficina, de manhã");
    await folha.getByLabel("O que está acontecendo").fill("Estou chegando para abrir a oficina");
    await folha.getByLabel("O que dá para mostrar").fill("A porta abrindo e a luz acendendo");
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marca));
    expect(roteiro.formato).toBe("story");
    expect(roteiro.duracaoDoVideo).toBe("curto");
    expect(roteiro.conteudo.capitulos ?? null).toBeNull();
  });

  test("escolheu o longo e trocou para sem fala: a pergunta some e o roteiro sai sem fala e curto", async ({ page }) => {
    const marca = await criarMarca("e2e-longo-troca-sem-fala", [8, 10, 12]);
    await entrar(page, "e2e-longo-troca-sem-fala");
    const folha = await abrirGravarAgora(page);

    await folha.getByRole("button", { name: "Mais de 3 minutos, para o YouTube" }).click();
    await folha.getByRole("tab", { name: "Sem fala" }).click();
    await expect(folha.getByText("Quanto tempo?")).toHaveCount(0);

    await folha.getByLabel("Onde você está").fill("Na oficina, de manhã");
    await folha.getByLabel("O que está acontecendo").fill("Estou limpando uma peça sem falar nada");
    await folha.getByLabel("O que dá para mostrar").fill("A peça antes e depois da limpeza");
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 60_000 });
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marca));
    expect(roteiro.estilo).toBe("sem_fala");
    expect(roteiro.duracaoDoVideo).toBe("curto");
    expect(roteiro.conteudo.capitulos ?? null).toBeNull();
  });

  test("o Story não tem a pergunta de duração", async ({ page }) => {
    await criarMarca("e2e-longo-story", [8, 10, 12]);
    await entrar(page, "e2e-longo-story");
    const folha = await abrirGravarAgora(page);

    await expect(folha.getByText("Quanto tempo?")).toBeVisible();
    await folha.getByRole("tab", { name: "Story" }).click();
    await expect(folha.getByText("Quanto tempo?")).toHaveCount(0);
    await folha.getByRole("tab", { name: "Vídeo" }).click();
    await expect(folha.getByText("Quanto tempo?")).toBeVisible();
  });
});
