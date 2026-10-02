/**
 * "Planejar os próximos dias" (V9b, item 3; V12, item 4b: a folha era "Colar
 * a agenda"; E39a: agora é uma das quatro portas sempre visíveis em `/criar`)
 * e o plano de gravações: cola uma agenda de dois dias, confere a lista, vê
 * o bloco "O seu plano de hoje" (também em `/criar` desde a E39a), aceita um
 * item até o roteiro, pula outro, vê a folha "Meu plano" e "Tirar este
 * plano". O caminho por áudio não tem e2e (mesmo raciocínio de
 * `momento.spec.ts`): a rota de transcrição é a mesma, já coberta em
 * `tests/integracao/momento-transcrever-route.test.ts`.
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
const EMAIL = "e2e-plano@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/**
 * E39a: "Planejar os próximos dias" é uma das quatro portas sempre visíveis em `/criar`.
 * E39c, parte 2a: a porta leva à aba Planejar (visão Semana, `/planejamento`), uma aba própria
 * desde a decisão do Gustavo de 01/10, 22:15 (antes dentro de Hoje); "Contar a minha agenda",
 * no cabeçalho do planejador, é quem abre a folha de texto ou voz.
 */
async function abrirPlanejarDias(page: Page) {
  await page.goto("/criar");
  await page.getByRole("button", { name: "Planejar os próximos dias" }).click();
  await expect(page).toHaveURL(/\/planejamento\?visao=semana/);
  /**
   * Semana vazia (a marca de teste começa sem nada planejado): o cartão "Nada marcado nesta
   * semana" tem o próprio "Contar a minha agenda" (`Planejar.dc.html`, estado `semanaVazia`),
   * além do mesmo botão no cabeçalho do planejador; os dois abrem a mesma folha, `.first()`
   * só desambigua qual o Playwright clica.
   */
  await page.getByRole("button", { name: "Contar a minha agenda" }).first().click();
}

test.describe("colar a agenda e o plano de gravações", () => {
  test.beforeAll(async () => {
    /**
     * Seguro para repetição (revisão do PR #62, item 4; achado do F1, item 4: o `onConflictDoNothing`
     * sozinho não bastava, `clientes`, `membrosMarca` e `briefings` não têm chave única contra o
     * `usuarioId` e uma segunda passada criava uma marca duplicada em silêncio, sem erro nenhum, em vez
     * de travar e avisar). Se a pessoa de teste já existe, a primeira passada já criou tudo.
     */
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-plano"));
    if (jaExiste) return;

    await db().insert(nichos).values({ slug: "e2e-plano", nome: "[teste] Plano" });
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "e2e-plano"));

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

    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas }).onConflictDoNothing();
  });

  test("cola uma agenda de dois dias, ve a lista, ve o bloco no Criar, aceita um item ate o roteiro, pula outro, ve Meu plano", async ({
    page,
  }) => {
    await entrar(page);
    await abrirPlanejarDias(page);
    const folhaAgenda = page.getByRole("dialog");
    await expect(folhaAgenda).toBeVisible();

    await folhaAgenda
      .getByLabel("Os seus próximos dias")
      .fill("hoje: fabrica do fornecedor, ver a linha nova, gravar o frasco; amanha: escritorio, reuniao de fechamento");
    await folhaAgenda.getByRole("button", { name: "Ver os dias" }).click();

    // A conferencia dos dias, antes de montar o plano (sem edicao campo a campo nesta rodada).
    await expect(folhaAgenda.getByText("Esses são os dias que a gente entendeu")).toBeVisible();
    await expect(folhaAgenda.getByText("ver a linha nova")).toBeVisible();
    await expect(folhaAgenda.getByText("reuniao de fechamento")).toBeVisible();

    await folhaAgenda.getByRole("button", { name: "Montar o plano" }).click();
    await expect(folhaAgenda).toBeHidden();

    // E39c, parte 1: "Contar a minha agenda" abre a partir do calendario, nao de /criar; "O seu
    // plano de hoje" continua so em /criar, so os itens de hoje (o dia de amanha nao aparece
    // aqui). `criarPlanoAction` só responde depois de gravar; limiar maior (revisão do PR #62,
    // item 4), mesmo valor que os outros pontos desta suíte que esperam uma Server Action
    // terminar (`momento.spec.ts`, `story.spec.ts`).
    await page.goto("/criar");
    await expect(page.getByText("O seu plano de hoje")).toBeVisible({ timeout: 20_000 });
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

    // Volta para o Criar e pula "gravar o frasco": o item some da lista.
    await page.goto("/criar");
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

  // V9d, item 4: um dia cuja referencia resolverDataRelativa nao entende ("na volta") nao some em
  // silencio; a folha mostra "não entendi este dia" e deixa a pessoa escolher a data.
  test("um dia 'na volta' vira 'nao entendi este dia', a pessoa escolhe a data e o item entra no plano", async ({
    page,
  }) => {
    // Data bem no futuro, calculada na hora do teste (nunca uma literal fixa): evita a mesma
    // corrosao ja achada nesta suite com data literal caindo no passado.
    const dataEscolhida = new Date();
    dataEscolhida.setFullYear(dataEscolhida.getFullYear() + 1);
    const dataEscolhidaISO = dataEscolhida.toISOString().slice(0, 10);

    await entrar(page);
    await abrirPlanejarDias(page);
    const folhaAgenda = page.getByRole("dialog");
    await expect(folhaAgenda).toBeVisible();

    await folhaAgenda
      .getByLabel("Os seus próximos dias")
      .fill("hoje: fabrica, ver a linha nova; na volta: escritorio, reuniao de fechamento");
    await folhaAgenda.getByRole("button", { name: "Ver os dias" }).click();

    await expect(folhaAgenda.getByText("Não entendi este dia")).toBeVisible();
    await expect(folhaAgenda.getByText("reuniao de fechamento")).toBeVisible();
    await expect(folhaAgenda.getByText('Você disse "na volta"')).toBeVisible();

    await folhaAgenda.getByLabel("Data").fill(dataEscolhidaISO);
    await folhaAgenda.getByRole("button", { name: "Montar o plano" }).click();
    await expect(folhaAgenda).toBeHidden();

    // E39c, parte 1: "Contar a minha agenda" abre a partir do calendario; "Meu plano" so existe em /criar.
    await page.goto("/criar");
    await page.getByRole("button", { name: "Meu plano" }).click();
    const folhaMeuPlano = page.getByRole("dialog", { name: "Meu plano" });
    await expect(folhaMeuPlano).toBeVisible();
    await expect(folhaMeuPlano.getByText("reuniao de fechamento")).toBeVisible();
  });

  // V9d, item 4: "deixar de fora" some com o cartao, e o dia nunca entra no plano.
  test("'deixar de fora' num dia nao entendido: o item nunca entra no plano", async ({ page }) => {
    await entrar(page);
    await abrirPlanejarDias(page);
    const folhaAgenda = page.getByRole("dialog");
    await expect(folhaAgenda).toBeVisible();

    await folhaAgenda
      .getByLabel("Os seus próximos dias")
      .fill("hoje: fabrica, conferir estoque; na volta: deposito, contar caixas");
    await folhaAgenda.getByRole("button", { name: "Ver os dias" }).click();

    await expect(folhaAgenda.getByText("Não entendi este dia")).toBeVisible();
    await folhaAgenda.getByRole("button", { name: "Deixar de fora" }).click();
    await expect(folhaAgenda.getByText("Não entendi este dia")).toHaveCount(0);

    await folhaAgenda.getByRole("button", { name: "Montar o plano" }).click();
    await expect(folhaAgenda).toBeHidden();

    // E39c, parte 1: "Contar a minha agenda" abre a partir do calendario; "Meu plano" so existe em /criar.
    await page.goto("/criar");
    await page.getByRole("button", { name: "Meu plano" }).click();
    const folhaMeuPlano = page.getByRole("dialog", { name: "Meu plano" });
    await expect(folhaMeuPlano).toBeVisible();
    await expect(folhaMeuPlano.getByText("conferir estoque")).toBeVisible();
    await expect(folhaMeuPlano.getByText("contar caixas")).toHaveCount(0);
  });

  // V12, item 4b: "Tirar este plano" apaga os dias que vem ainda nao aceitos; o de hoje, ja aceito
  // (um roteiro escrito a partir dele), continua. Conta de novo (nao reaproveita a de cima): o teste
  // depende do plano comecar vazio, e os tres testes acima ja deixam varios dias no plano da "e2e-plano".
  test("'Tirar este plano': apaga so o que ainda nao foi aceito, o que ja virou roteiro continua", async ({ page }) => {
    const email = "e2e-plano-tirar@exemplo.teste";
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "e2e-plano"));

    await db().insert(user).values({ id: "e2e-plano-tirar", name: "[teste] Plano Tirar", email });
    await db().insert(account).values({
      id: "e2e-plano-tirar-credential",
      issuer: "local:credential",
      accountId: "e2e-plano-tirar",
      providerId: "credential",
      userId: "e2e-plano-tirar",
      password: await hashPassword(SENHA),
    });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-plano-tirar", aceitouTermosEm: new Date() });
    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-plano-tirar", nome: "[teste] Plano Tirar", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-plano-tirar", clienteId: marca.id, papel: "dono" });
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

    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);

    // V12, "confirme com um teste de descricao livre": uma frase corrida, nao uma lista telegrafica,
    // ainda com o dia antes dos dois pontos (do jeito que a pessoa fala ao contar a agenda em voz alta).
    await abrirPlanejarDias(page);
    const folhaAgenda = page.getByRole("dialog");
    await expect(folhaAgenda).toBeVisible();
    await folhaAgenda
      .getByLabel("Os seus próximos dias")
      .fill(
        "hoje: vou ficar de manhã na oficina, revisando a peça nova antes de mandar pro cliente; " +
          "depois de amanha: tem a feira do fornecedor, e lá eu quero ver o estande novo dele",
      );
    await folhaAgenda.getByRole("button", { name: "Ver os dias" }).click();
    await expect(folhaAgenda.getByText("Esses são os dias que a gente entendeu")).toBeVisible();
    await folhaAgenda.getByRole("button", { name: "Montar o plano" }).click();
    await expect(folhaAgenda).toBeHidden();

    // E39c, parte 1: "Contar a minha agenda" abre a partir do calendario, nao de /criar.
    await page.goto("/criar");
    await expect(page.getByText("O seu plano de hoje")).toBeVisible({ timeout: 20_000 });
    const linhaAceitar = page.locator("div").filter({ hasText: "revisando a peça nova" }).last();
    await linhaAceitar.getByRole("button", { name: "Escrever o roteiro" }).click();
    const folhaGravar = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folhaGravar).toBeVisible();
    await folhaGravar.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    await page.goto("/criar");
    await page.getByRole("button", { name: "Meu plano" }).click();
    const folhaMeuPlano = page.getByRole("dialog", { name: "Meu plano" });
    await expect(folhaMeuPlano).toBeVisible();
    await expect(folhaMeuPlano.getByText("estande novo")).toBeVisible();

    await folhaMeuPlano.getByRole("button", { name: "Tirar este plano" }).click();
    await expect(folhaMeuPlano.getByText("Tirar o plano dos próximos dias? Os roteiros já escritos continuam.")).toBeVisible();
    await folhaMeuPlano.getByRole("button", { name: "Tirar este plano" }).click();
    await expect(folhaMeuPlano).toBeHidden();

    /**
     * Reabre "Meu plano": o dia de hoje (ja aceito, com roteiro) continua; "depois de amanha" sumiu.
     * `page.goto` de proposito, nao só esperar: o `history.back()` que fecha a folha (mesma ordem de
     * `FolhaPlanejarDias.confirmar()`, "router.refresh() e só depois aoFechar()") reaproveita o
     * retrato daquela entrada do histórico de antes do `refresh`, e reabrir sem navegar de novo
     * mostrava "estande novo" preso, confirmado com uma consulta direta ao banco (a linha já não
     * existe la, só a tela é que ficava velha). Achado desta etapa; registrado em `TODO.md`,
     * "Decisões pendentes".
     */
    await page.goto("/criar");
    await page.getByRole("button", { name: "Meu plano" }).click();
    const folhaMeuPlanoDepois = page.getByRole("dialog", { name: "Meu plano" });
    await expect(folhaMeuPlanoDepois).toBeVisible();
    await expect(folhaMeuPlanoDepois.getByText("revisando a peça nova")).toBeVisible();
    await expect(folhaMeuPlanoDepois.getByText("Roteiro pronto")).toBeVisible();
    await expect(folhaMeuPlanoDepois.getByText("estande novo")).toHaveCount(0);
  });

  // E39c, parte 1, item 3: a porta "Planejar os próximos dias" leva ao calendário, não direto à
  // folha de texto; um dia tocado sem nada marcado ganha "Criar roteiro" (a E39a já leva a data).
  test("a porta 'Planejar os próximos dias' leva ao calendário, e um dia vazio tocado tem 'Criar roteiro'", async ({
    page,
  }) => {
    const email = "e2e-plano-porta-calendario@exemplo.teste";
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "e2e-plano"));

    await db().insert(user).values({ id: "e2e-plano-porta-calendario", name: "[teste] Plano Porta Calendario", email });
    await db().insert(account).values({
      id: "e2e-plano-porta-calendario-credential",
      issuer: "local:credential",
      accountId: "e2e-plano-porta-calendario",
      providerId: "credential",
      userId: "e2e-plano-porta-calendario",
      password: await hashPassword(SENHA),
    });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-plano-porta-calendario", aceitouTermosEm: new Date() });
    const [marcaNova] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-plano-porta-calendario", nome: "[teste] Plano Porta Calendario", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-plano-porta-calendario", clienteId: marcaNova.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marcaNova.id,
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

    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);

    await page.goto("/criar");
    await page.getByRole("button", { name: "Planejar os próximos dias" }).click();
    await expect(page).toHaveURL(/\/planejamento\?visao=semana/);

    // A marca é nova: nada marcado em nenhum dia; o de hoje tem "Criar roteiro" e leva a /criar com a data de hoje.
    await page.getByRole("region", { name: /, hoje$/ }).getByRole("button", { name: "Criar roteiro" }).click();
    await expect(page).toHaveURL(new RegExp(`/criar\\?data=${hojeISO()}`));
  });

  // E39c, parte 1, item 1: o X no cabeçalho fecha a folha (`Folha.tsx`), igual ao véu e ao Escape.
  test("o X fecha a folha de planejar e a de Meu plano", async ({ page }) => {
    const email = "e2e-plano-fechar-x@exemplo.teste";
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "e2e-plano"));

    await db().insert(user).values({ id: "e2e-plano-fechar-x", name: "[teste] Plano Fechar X", email });
    await db().insert(account).values({
      id: "e2e-plano-fechar-x-credential",
      issuer: "local:credential",
      accountId: "e2e-plano-fechar-x",
      providerId: "credential",
      userId: "e2e-plano-fechar-x",
      password: await hashPassword(SENHA),
    });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-plano-fechar-x", aceitouTermosEm: new Date() });
    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-plano-fechar-x", nome: "[teste] Plano Fechar X", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-plano-fechar-x", clienteId: marca.id, papel: "dono" });
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

    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);

    // A folha de planejar: o X fecha sem pedir nada, de volta ao calendario de onde ela abriu.
    await abrirPlanejarDias(page);
    const folhaPlanejar = page.getByRole("dialog");
    await expect(folhaPlanejar).toBeVisible();
    await folhaPlanejar.getByRole("button", { name: "Fechar" }).click();
    await expect(folhaPlanejar).toBeHidden();
    await expect(page).toHaveURL(/\/planejamento/);

    // Um plano de hoje, so para "Meu plano" aparecer em /criar.
    await abrirPlanejarDias(page);
    const folhaAgenda = page.getByRole("dialog");
    await folhaAgenda.getByLabel("Os seus próximos dias").fill("hoje: oficina, lavar um sofa de tres lugares");
    await folhaAgenda.getByRole("button", { name: "Ver os dias" }).click();
    await folhaAgenda.getByRole("button", { name: "Montar o plano" }).click();
    await expect(folhaAgenda).toBeHidden();

    await page.goto("/criar");
    await expect(page.getByText("O seu plano de hoje")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Meu plano" }).click();
    const folhaMeuPlano = page.getByRole("dialog", { name: "Meu plano" });
    await expect(folhaMeuPlano).toBeVisible();
    await folhaMeuPlano.getByRole("button", { name: "Fechar" }).click();
    await expect(folhaMeuPlano).toBeHidden();
  });
});
