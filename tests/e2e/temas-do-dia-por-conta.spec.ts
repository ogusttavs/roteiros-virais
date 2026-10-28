/**
 * E61 PR 2, os temas do dia por conta, pela tela `/criar/temas` (28/10/2026): duas contas do MESMO setor, no mesmo dia, veem temas diferentes quando uma tem foco confirmado e a outra não;
 * o tema que veio do setor (o foco não achou vídeo que o sustente) traz a frase que diz isso; e a conta sem foco vê exatamente os temas do setor. Roda no celular e no computador.
 *
 * Grava `temas_dia` e `temas_dia_conta` direto no banco (a geração em si tem o teste de integração) e só lê a tela. Seguro para a repetição automática do Playwright: cada teste refaz as linhas do dia.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, temasDia, temasDiaConta, user, type PerfilCompilado, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { hashDoFoco } from "../../src/servicos/temas-da-conta";

const SENHA = "ExemploSenha123";
const FOCO = "marketing e automação com IA para donos de pequena empresa";

const PERFIL: PerfilCompilado = {
  fatos: { oQueVende: "automação de atendimento", preco: "mentoria mensal", clienteIdeal: "dono de pequena empresa", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: ["a tela do computador"], concorrentes: [], perfisAdmirados: [] },
  resumo: "ensina dono de empresa a automatizar o marketing com IA",
  referencias: [],
};

const tema = (titulo: string, extra: Partial<TemaDoDia> = {}): TemaDoDia => ({ titulo, descricao: "descrição do tema", porQue: `Por que o tema ${titulo} funciona hoje.`, evidencias: [], evidenciasNoticias: [], puxaPara: "alcance", ...extra });

const TEMAS_DO_SETOR = [tema("Tema do setor um"), tema("Tema do setor dois"), tema("Tema do setor três")];
const TEMAS_DA_CONTA = [tema("Tema do foco um"), tema("Tema do foco dois"), tema("Tema do setor um", { doSetor: true })];

let nichoId = 0;
let comFocoId = 0;

async function criarMarca(usuario: string, nome: string, extra: Partial<typeof clientes.$inferInsert>): Promise<number> {
  const [existente] = await db().select().from(clientes).where(eq(clientes.usuarioId, usuario));
  if (existente) return existente.id;
  await db().insert(user).values({ id: usuario, name: nome, email: `${usuario}@exemplo.teste` });
  await db().insert(account).values({ id: `${usuario}-credential`, issuer: "local:credential", accountId: usuario, providerId: "credential", userId: usuario, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: usuario, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: usuario, nome, nichoId, tipo: "pessoa", persona: "conhecido", alcance: "brasil", ...extra }).returning();
  await db().insert(membrosMarca).values({ usuarioId: usuario, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: marca.id, completo: true, notaGeral: "8.50", perfil: PERFIL });
  return marca.id;
}

async function prepararDados() {
  if (!nichoId) {
    const [existente] = await db().select().from(nichos).where(eq(nichos.slug, "e2e-temas-por-conta"));
    nichoId = existente ? existente.id : (await db().insert(nichos).values({ slug: "e2e-temas-por-conta", nome: "Empreendedorismo teste dois", termos: [], pisoViews: 0 }).returning())[0].id;
  }
  comFocoId = await criarMarca("e2e-tpc-com-foco", "[teste] Com foco", { foco: FOCO, focoOrigem: "escrito", focoConfirmadoEm: new Date() });
  await criarMarca("e2e-tpc-sem-foco", "[teste] Sem foco", {});
  await db().delete(temasDiaConta).where(eq(temasDiaConta.clienteId, comFocoId));
  await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: TEMAS_DO_SETOR });
  await db().insert(temasDiaConta).values({ clienteId: comFocoId, data: hojeISO(), temas: TEMAS_DA_CONTA, focoUsado: FOCO, focoHash: hashDoFoco(FOCO), candidatosHash: "e2e" });
}

async function abrirOsTemas(page: Page, usuario: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(`${usuario}@exemplo.teste`);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
  await page.goto("/criar/temas");
}

const FRASE_DO_SETOR = "Do seu setor em geral: ainda não achamos um vídeo do seu assunto que mostre que o tema funciona.";

for (const [nome, viewport] of [
  ["no computador", { width: 1280, height: 900 }],
  ["no celular", { width: 390, height: 844 }],
] as const) {
  test.describe(`temas do dia por conta ${nome}`, () => {
    test.use({ viewport });
    test.beforeEach(prepararDados);

    test("a conta com foco vê os temas escritos para o foco, e o que veio do setor traz a frase que diz isso", async ({ page }) => {
      await abrirOsTemas(page, "e2e-tpc-com-foco");
      await expect(page.getByRole("heading", { name: "Tema do foco um", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tema do foco dois", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tema do setor um", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tema do setor dois", exact: true })).toHaveCount(0);
      await expect(page.getByText(FRASE_DO_SETOR)).toHaveCount(1);
    });

    test("a conta sem foco, no mesmo setor e no mesmo dia, vê exatamente os temas do setor, sem a frase do foco", async ({ page }) => {
      await abrirOsTemas(page, "e2e-tpc-sem-foco");
      await expect(page.getByRole("heading", { name: "Tema do setor um", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tema do setor dois", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tema do setor três", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tema do foco um", exact: true })).toHaveCount(0);
      await expect(page.getByText(FRASE_DO_SETOR)).toHaveCount(0);
    });

    test("a conta que muda o foco volta aos temas do setor na hora, sem esperar o job", async ({ page }) => {
      await db().update(clientes).set({ foco: "outro assunto qualquer sobre vendas" }).where(eq(clientes.id, comFocoId));
      try {
        await abrirOsTemas(page, "e2e-tpc-com-foco");
        await expect(page.getByRole("heading", { name: "Tema do setor dois", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Tema do foco um", exact: true })).toHaveCount(0);
      } finally {
        await db().update(clientes).set({ foco: FOCO }).where(eq(clientes.id, comFocoId));
      }
    });
  });
}
