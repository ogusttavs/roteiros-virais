/**
 * O plano `sem_limite` (V9b-0, `PROXIMO.md`): historicamente, a marca com o
 * interruptor ligado gerava quantos roteiros quisesse no mesmo dia e via um
 * cartão por roteiro, sempre com os três temas visíveis abaixo; a marca
 * `padrao` (o padrão do schema) via só um cartão, com "Ver os outros temas de
 * hoje" e "Trocar".
 *
 * TODO(e2e-fix): depois da E39a (Hoje virou a agenda, Criar virou a oficina),
 * essa distinção não aparece mais em lugar nenhum da UI nova, para nenhum dos
 * dois planos. `/criar/temas` (`TemasTela.tsx`) sempre mostra os três temas
 * com o botão "Quero esse" (nunca "Escrever o roteiro"); `/hoje`
 * (`HojeTela.tsx`, a agenda) só mostra o Reels mais recente do dia, nunca uma
 * lista com contagem ("Seus roteiros de hoje (n)") (comentário em
 * `agendaDoDia`, `src/servicos/roteiro.ts`: "Com mais de um Reels no mesmo
 * dia... fica o mais recente; os demais continuam no Histórico"). Os textos
 * `seusRoteirosDeHoje`, `verOutros`, `esconderOutros`, `contagemTemas` e
 * `trocarTemaAviso` (`src/textos/hoje.ts`) não são mais referenciados em
 * nenhum componente. Isso parece um gap real deixado pela E39a (o plano
 * `sem_limite` continua no schema e no admin, `SeletorPlanoAdmin.tsx`, mas
 * sem efeito visível no painel do cliente), não só um seletor velho; registrado
 * no relatório desta rodada para o Fable decidir se o `sem_limite` volta ao
 * painel ou se o plano sai de cena. Os dois testes abaixo cobrem só o que dá
 * para confirmar na UI atual: gerar funciona nos dois planos, e os temas
 * continuam visíveis depois de gerar um roteiro.
 *
 * Mesma lição de `temas-do-dia.spec.ts` e `roteiro.spec.ts`: grava briefing e
 * tema do dia direto no banco, e deixa só a geração do roteiro passar pelo
 * navegador, contra o `AI_PROVIDER=mock` do servidor. Nicho próprio
 * ("e2e-sem-limite"), sem `resetarSchema` (o seed roda uma vez só, no
 * globalSetup).
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

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const PERFIL_PADRAO = {
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
};

async function criarClienteComPlano(
  usuarioId: string,
  email: string,
  nichoId: number,
  plano: "padrao" | "sem_limite",
) {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${usuarioId}`, email });
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

  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${usuarioId}`, nichoId, plano }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });

  return cliente;
}

/** E39a: os temas do dia ficam na rota "/criar/temas", igual para os dois planos. */
async function escolherTemaEGerar(page: Page, tituloTema: string) {
  await page.goto("/criar/temas");
  const cartao = page.getByRole("heading", { name: tituloTema });
  await expect(cartao).toBeVisible();
  await cartao.locator("../..").getByRole("button", { name: "Quero esse" }).click();

  await expect(page).toHaveURL(/\/criar\/objetivo/);
  await page.getByRole("radio", { name: /gente me chamar para comprar/i }).click();
  await page.getByRole("button", { name: "escrever o roteiro", exact: true }).click();
  await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
}

test.describe("plano por marca (V9b-0)", () => {
  let nichoId: number;

  test.beforeAll(async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-sem-limite", nome: "[teste] Sem limite" })
      .returning();
    nichoId = nicho.id;

    const temas: TemaDoDia[] = [
      { titulo: "tema sem limite 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema sem limite 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema sem limite 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
  });

  test("plano sem_limite: gera roteiro de dois temas diferentes no mesmo dia, com os temas sempre visiveis", async ({
    page,
  }) => {
    await criarClienteComPlano("e2e-sem-limite-a", "e2e-sem-limite-a@exemplo.teste", nichoId, "sem_limite");
    await entrar(page, "e2e-sem-limite-a@exemplo.teste");

    await escolherTemaEGerar(page, "tema sem limite 1");

    // TODO(e2e-fix): a agenda nova (`HojeTela.tsx`) só mostra o Reels mais recente do dia, para
    // qualquer plano; não há mais lista nem contagem em /hoje (ver o comentário no topo deste
    // arquivo). Confirma só que o roteiro de hoje aparece.
    await page.goto("/hoje");
    await expect(page.getByText("tema sem limite 1")).toBeVisible();

    // Os tres temas continuam visiveis, mesmo com um roteiro ja gerado hoje.
    await escolherTemaEGerar(page, "tema sem limite 2");

    // O mais recente substitui o anterior na agenda (comportamento documentado de `agendaDoDia`).
    await page.goto("/hoje");
    await expect(page.getByText("tema sem limite 2")).toBeVisible();

    // Os temas continuam visiveis mesmo com dois roteiros ja gerados hoje.
    await page.goto("/criar/temas");
    await expect(page.getByRole("heading", { name: "tema sem limite 3" })).toBeVisible();
  });

  test("plano padrao: gerar um roteiro tambem funciona, com os temas continuando visiveis", async ({ page }) => {
    await criarClienteComPlano("e2e-sem-limite-b", "e2e-sem-limite-b@exemplo.teste", nichoId, "padrao");
    await entrar(page, "e2e-sem-limite-b@exemplo.teste");

    await escolherTemaEGerar(page, "tema sem limite 1");

    // TODO(e2e-fix): ver o comentário no topo deste arquivo. "Ver os outros temas de hoje" e
    // "Trocar" não existem mais; /criar/temas já mostra os três temas direto, para os dois planos.
    await page.goto("/hoje");
    await expect(page.getByText("tema sem limite 1")).toBeVisible();

    await page.goto("/criar/temas");
    await expect(page.getByRole("heading", { name: "tema sem limite 2" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema sem limite 3" })).toBeVisible();
  });
});
