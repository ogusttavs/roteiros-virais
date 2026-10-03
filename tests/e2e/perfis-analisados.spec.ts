/**
 * E38, partes 2 e 3 ("o contexto da marca"): a seção "O que a IA viu nos perfis" no briefing, e a
 * lista de perfis indicados no admin do setor. O job `analisar-perfil` (API de verdade) não roda
 * aqui (chave zerada no e2e, `MODO_E2E`); cada teste grava a linha de `perfis_analisados` direto
 * no banco, como já fazem os outros specs deste projeto com avaliação de briefing. O handle usado
 * como "perfil citado real de teste" é `natgeo`, a mesma conta pública já citada em `TODO.md` como
 * exemplo de chamada à Business Discovery da Meta; nunca dado de cliente.
 */
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  perfisAnalisados,
  preferenciasUsuario,
  user,
  type AvaliacaoResposta,
} from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function entrar(page: import("@playwright/test").Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

/** `/briefing` só existe depois de completo (onboarding obrigatório); sem isso a marca cai em `/comecar`. */
async function criarClienteComBriefingCompleto(id: string, nichoSlug = "dentistas") {
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, nichoSlug));
  await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@exemplo.teste` });
  await db()
    .insert(account)
    .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });

  const avaliacaoNota9 = (perguntaId: string): AvaliacaoResposta => ({
    nota: 9,
    bom: `A resposta de ${perguntaId} tem exemplo concreto.`,
    melhorar: "Poderia trazer mais um numero ou exemplo.",
    como: "Escreva como se fosse para alguem que nunca ouviu falar do seu ramo, com um caso real.",
    impacto: "Uma resposta mais concreta gera um roteiro mais parecido com voce.",
  });
  const respostas: Record<string, string> = {};
  const avaliacoes: Record<string, AvaliacaoResposta> = {};
  for (const perguntaId of ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]) {
    respostas[perguntaId] = `Resposta concreta para ${perguntaId}, com o numero 42 na frase.`;
    avaliacoes[perguntaId] = avaliacaoNota9(perguntaId);
  }
  await db().insert(briefings).values({ clienteId: cliente.id, respostas, avaliacoes, notaGeral: "9.00", completo: true });

  return cliente.id;
}

test.describe("briefing, 'O que a IA viu nos perfis'", () => {
  test("sem nenhum perfil analisado: mostra o vazio", async ({ page }) => {
    await criarClienteComBriefingCompleto("e2e-perfis-analisados-vazio");

    await entrar(page, "e2e-perfis-analisados-vazio@exemplo.teste");
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/briefing");

    const secao = page.locator("section", { hasText: "O que a IA viu nos perfis" });
    await expect(secao.getByRole("heading", { name: "O que a IA viu nos perfis" })).toBeVisible();
    await expect(secao.getByText("Ainda nada. Cite um concorrente")).toBeVisible();
  });

  test("com um concorrente citado real e o proprio perfil pendente: mostra os dois estados", async ({ page }) => {
    const clienteId = await criarClienteComBriefingCompleto("e2e-perfis-analisados-cheio");
    await db().insert(perfisAnalisados).values([
      {
        clienteId,
        perfilCitadoId: null,
        origem: "citado",
        rede: "instagram",
        handle: "natgeo",
        existeNaRede: true,
        leitura: "Posta fotos e vídeos curtos de natureza, sempre com uma legenda que conta uma história.",
      },
      {
        clienteId,
        perfilCitadoId: null,
        origem: "propria_marca",
        rede: "youtube",
        handle: "exemplo-loja",
        existeNaRede: true,
        leitura: null,
      },
    ]);

    await entrar(page, "e2e-perfis-analisados-cheio@exemplo.teste");
    await expect(page).toHaveURL(/\/hoje/);
    await page.goto("/briefing");

    const secao = page.locator("section", { hasText: "O que a IA viu nos perfis" });
    await expect(secao.getByText("@natgeo")).toBeVisible();
    await expect(secao.getByText("concorrente citado")).toBeVisible();
    await expect(secao.getByText("Posta fotos e vídeos curtos de natureza")).toBeVisible();

    await expect(secao.getByText("@exemplo-loja")).toBeVisible();
    await expect(secao.getByText("o seu perfil")).toBeVisible();
    await expect(secao.getByText("Ainda lendo este perfil.")).toBeVisible();
  });
});

test.describe("admin do setor, perfis indicados", () => {
  test("lista so quem qualificou e ainda nao virou conta, com o botao de virar conta do setor", async ({ page }) => {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
    const clienteId = await criarClienteComBriefingCompleto("e2e-admin-perfis-indicados");
    await db().insert(perfisAnalisados).values([
      {
        clienteId,
        perfilCitadoId: null,
        origem: "citado",
        rede: "instagram",
        handle: "e2e-indicado-qualifica",
        qualificaParaSetor: true,
      },
      {
        clienteId,
        perfilCitadoId: null,
        origem: "citado",
        rede: "instagram",
        handle: "e2e-indicado-nao-qualifica",
        qualificaParaSetor: false,
      },
      {
        clienteId,
        perfilCitadoId: null,
        origem: "citado",
        rede: "instagram",
        handle: "e2e-indicado-ja-virou",
        qualificaParaSetor: true,
        viraDoSetorEm: new Date(),
      },
    ]);

    await entrar(page, "admin@exemplo.teste");
    await expect(page).toHaveURL(/\/admin\/clientes/);
    await page.goto(`/admin/nichos/${nicho.slug}`);

    await expect(page.getByRole("heading", { name: "perfis indicados pelos clientes" })).toBeVisible();
    const linhaQualifica = page.getByText("e2e-indicado-qualifica").locator("..");
    await expect(linhaQualifica.getByRole("button", { name: "virar conta do setor" })).toBeVisible();

    await expect(page.getByText("e2e-indicado-nao-qualifica")).toHaveCount(0);
    await expect(page.getByText("e2e-indicado-ja-virou")).toHaveCount(0);
  });
});
