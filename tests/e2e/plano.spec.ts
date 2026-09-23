/**
 * "Colar a agenda" e o plano de gravações (V9b, item 3, definição de pronto
 * do `PROXIMO.md`): cola uma agenda de dois dias, confere a lista, vê o
 * bloco "O seu plano de hoje", aceita um item até o roteiro, pula outro, e
 * vê a folha "Meu plano". O caminho por áudio não tem e2e (mesmo raciocínio
 * de `momento.spec.ts`): a rota de transcrição é a mesma, já coberta em
 * `tests/integracao/momento-transcrever-route.test.ts`.
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
const EMAIL = "e2e-plano@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("colar a agenda e o plano de gravações", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-plano", nome: "[teste] Plano" }).returning();

    await db().insert(user).values({ id: "e2e-plano", name: "[teste] Plano", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-plano-credential",
        issuer: "local:credential",
        accountId: "e2e-plano",
        providerId: "credential",
        userId: "e2e-plano",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-plano", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-plano", nome: "[teste] Plano", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-plano", clienteId: marca.id, papel: "dono" });
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

    // O botao "Colar a agenda" fica ao lado de "Gravar agora" (item 3 do PROXIMO.md): sem uma
    // linha em temas_dia para hoje, /hoje cai no estado "sem_tema", que nao usa HojeTela.
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("cola uma agenda de dois dias, ve a lista, ve o bloco no Hoje, aceita um item ate o roteiro, pula outro, ve Meu plano", async ({
    page,
  }) => {
    await entrar(page);
    await page.goto("/hoje");

    await page.getByRole("button", { name: "Colar a agenda" }).click();
    const folhaAgenda = page.getByRole("dialog", { name: "Colar a agenda" });
    await expect(folhaAgenda).toBeVisible();

    await folhaAgenda
      .getByLabel("A sua agenda")
      .fill("hoje: fabrica do fornecedor, ver a linha nova, gravar o frasco; amanha: escritorio, reuniao de fechamento");
    await folhaAgenda.getByRole("button", { name: "Ver os dias" }).click();

    // A conferencia dos dias, antes de montar o plano (sem edicao campo a campo nesta rodada).
    await expect(folhaAgenda.getByText("Esses são os dias que a gente entendeu")).toBeVisible();
    await expect(folhaAgenda.getByText("ver a linha nova")).toBeVisible();
    await expect(folhaAgenda.getByText("reuniao de fechamento")).toBeVisible();

    await folhaAgenda.getByRole("button", { name: "Montar o plano" }).click();
    await expect(folhaAgenda).toBeHidden();

    // "O seu plano de hoje", so os itens de hoje (o dia de amanha nao aparece aqui).
    await expect(page.getByText("O seu plano de hoje")).toBeVisible();
    await expect(page.getByText("reuniao de fechamento")).toHaveCount(0);

    // Aceita "ver a linha nova": abre a folha "Gravar agora" pre-preenchida, e o roteiro sai com origem momento.
    const linhaAceitar = page.locator("div").filter({ hasText: "ver a linha nova" }).last();
    await linhaAceitar.getByRole("button", { name: "Escrever o roteiro" }).click();

    const folhaGravar = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folhaGravar).toBeVisible();
    await expect(folhaGravar.getByLabel("Onde você está")).toHaveValue("fabrica do fornecedor");
    await expect(folhaGravar.getByLabel("O que está acontecendo")).toHaveValue("ver a linha nova");

    await folhaGravar.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);
    await expect(page.getByText("Este roteiro veio do momento que você descreveu")).toBeVisible();

    // Volta para o Hoje e pula "gravar o frasco": o item some da lista.
    await page.goto("/hoje");
    await expect(page.getByText("gravar o frasco")).toBeVisible();
    const linhaPular = page.locator("div").filter({ hasText: "gravar o frasco" }).last();
    await linhaPular.getByRole("button", { name: "Pular" }).click();
    await expect(page.getByText("gravar o frasco")).toHaveCount(0);

    // "Meu plano": mostra os dois dias, o de hoje (com o item aceito) e o de amanha.
    await page.getByRole("button", { name: "Meu plano" }).click();
    const folhaMeuPlano = page.getByRole("dialog", { name: "Meu plano" });
    await expect(folhaMeuPlano).toBeVisible();
    await expect(folhaMeuPlano.getByText("ver a linha nova")).toBeVisible();
    await expect(folhaMeuPlano.getByText("Roteiro pronto")).toBeVisible();
    await expect(folhaMeuPlano.getByText("escritorio").first()).toBeVisible();
    await expect(folhaMeuPlano.getByText("reuniao de fechamento")).toBeVisible();
  });
});
