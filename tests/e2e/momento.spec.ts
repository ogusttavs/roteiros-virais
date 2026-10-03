/**
 * "Gravar agora" (V9a, item 1, 3 e 5): o caminho por texto, de ponta a
 * ponta, entrando pelo Hoje e (num teste leve) pelo Tema livre. O caminho
 * por áudio não tem e2e (definição de pronto da V9a): `MediaRecorder`
 * pede microfone de verdade, o `PROXIMO.md` só pede o teste de integração
 * da rota, já em `tests/integracao/momento-transcrever-route.test.ts`.
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
import { textosHoje } from "../../src/textos/hoje";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-momento@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

/** E39a: "Contar o momento", em `/criar`, abre a folha "Gravar agora" direto. */
async function abrirGravarAgora(page: Page) {
  await page.goto("/criar");
  await page.getByRole("button", { name: "Contar o momento" }).click();
}

test.describe("gravar agora, o caminho por texto", () => {
  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-momento"));
    if (jaExiste) return;

    const [nicho] = await db().insert(nichos).values({ slug: "e2e-momento", nome: "[teste] Momento" }).returning();

    await db().insert(user).values({ id: "e2e-momento", name: "[teste] Momento", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-momento-credential",
        issuer: "local:credential",
        accountId: "e2e-momento",
        providerId: "credential",
        userId: "e2e-momento",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-momento", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-momento", nome: "[teste] Momento", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-momento", clienteId: marca.id, papel: "dono" });
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
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("pelo Criar: preenche os tres campos, escolhe o objetivo, e o roteiro sai com origem momento", async ({ page }) => {
    await entrar(page);
    await abrirGravarAgora(page);
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("no aeroporto, cinco da manha");
    await folha
      .getByLabel("O que está acontecendo")
      .fill("esperando o embarque para a feira de fornecedores");
    await folha.getByLabel("O que dá para mostrar").fill("a fila do check-in e a mala de amostras");
    await folha.getByRole("radio", { name: "Gente me chamar para comprar" }).click();

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    // "De onde veio" mostra que este roteiro veio do momento, nao de um video do banco (item 1).
    await expect(page.getByText("Este roteiro veio do momento que você descreveu")).toBeVisible();
  });

  // E39c, parte 1, item 1: o X no cabeçalho fecha a folha (`Folha.tsx`), igual ao véu e ao Escape.
  test("o X fecha a folha de 'Gravar agora'", async ({ page }) => {
    await entrar(page);
    await abrirGravarAgora(page);
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByRole("button", { name: "Fechar" }).click();
    await expect(folha).toBeHidden();
  });

  test("campo vazio: nao envia e mostra o aviso", async ({ page }) => {
    await entrar(page);
    await abrirGravarAgora(page);
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(folha.getByText("conte onde você está, o que está acontecendo e o que dá para mostrar")).toBeVisible();
    await expect(folha).toBeVisible();
  });

  test("pelo Tema livre: 'Estou num momento' abre a mesma folha", async ({ page }) => {
    await entrar(page);
    await page.goto("/criar/tema-livre");

    await page.getByRole("button", { name: "Estou num momento" }).click();
    await expect(page.getByRole("dialog", { name: "Gravar agora" })).toBeVisible();
  });

  /**
   * V11, item 2 e item 3a: a tela de espera com a claquete cobre a tela
   * enquanto o servidor escreve (E39a: agora a partir de `/criar`, não mais
   * `/hoje`). Com `AI_PROVIDER=mock` a resposta é rápida demais para pegar a
   * tela por sorte; atrasa o pedido da Server Action um pouco (mesma técnica
   * de `sem-rede.spec.ts`, `next-action` no cabeçalho) só para este teste ter
   * uma janela confiável de asserção.
   */
  test("a tela de espera com a claquete cobre a tela enquanto o roteiro escreve", async ({ page }) => {
    let atrasou = false;
    await page.route("**/*", async (rota) => {
      const pedido = rota.request();
      if (!atrasou && pedido.method() === "POST" && pedido.headers()["next-action"]) {
        atrasou = true;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await rota.continue();
    });

    await entrar(page);
    await abrirGravarAgora(page);
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("no ponto de ônibus");
    await folha.getByLabel("O que está acontecendo").fill("esperando enquanto o cliente liga");
    await folha.getByLabel("O que dá para mostrar").fill("o produto na sacola");
    await folha.getByRole("radio", { name: "Mais gente me conhecer" }).click();

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();

    // A folha fecha na hora e a tela de espera cobre a tela, sem barra de abas (item 2 e 3a).
    await expect(folha).toHaveCount(0);
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByText("Escrevendo o seu roteiro")).toBeVisible();
    await expect(page.getByText("Pode levar até 3 minutos")).toBeVisible();

    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
    await page.unroute("**/*");
  });
});

/**
 * H3, item 1: antes, uma marca sem tema de hoje (nenhuma linha em
 * `temas_dia` ainda) caía num estado à parte. Hoje (E39a) o aviso substitui
 * só os três temas em `/criar/temas`; as outras portas de `/criar`, como
 * "Contar o momento", continuam funcionando normalmente mesmo sem tema.
 */
test.describe("marca sem tema, as portas de Criar continuam funcionando", () => {
  const EMAIL_SEM_TEMA = "e2e-momento-sem-tema@exemplo.teste";

  test.beforeAll(async () => {
    // Seguro para a repetição automática do Playwright (F1, item 4): ver `aceite-termos.spec.ts`.
    const [jaExiste] = await db().select({ id: user.id }).from(user).where(eq(user.id, "e2e-momento-sem-tema"));
    if (jaExiste) return;

    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-momento-sem-tema", nome: "[teste] Momento sem tema" })
      .returning();

    await db().insert(user).values({ id: "e2e-momento-sem-tema", name: "[teste] Sem tema", email: EMAIL_SEM_TEMA });
    await db()
      .insert(account)
      .values({
        id: "e2e-momento-sem-tema-credential",
        issuer: "local:credential",
        accountId: "e2e-momento-sem-tema",
        providerId: "credential",
        userId: "e2e-momento-sem-tema",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-momento-sem-tema", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-momento-sem-tema", nome: "[teste] Sem tema", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-momento-sem-tema", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "consultoria financeira",
          preco: "pacote mensal por R$ 400",
          clienteIdeal: "autonomo",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "consultoria financeira para autonomos",
        referencias: [],
      },
    });
    // De propósito, nenhuma linha em temas_dia: o nicho nunca teve coleta.
  });

  test("a 390px: /criar/temas mostra o aviso no lugar dos temas, e 'Contar o momento' gera um roteiro normalmente", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(EMAIL_SEM_TEMA);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/hoje/);

    /**
     * E45 PR 2 (decisão 35): este setor não tem vídeo nenhum, de propósito (o nicho nunca teve coleta), e é o caso do ramo que ainda está começando
     * a ser pesquisado: a tela diz isso, a qualquer hora, em vez de "Hoje não saiu tema" (que parecia uma falha). O texto que muda com a hora
     * ("saem até as 6h30" antes, "hoje não saiu" depois, F1 ajuste B, H3 item 1) continua valendo para o setor que já tem vídeo, e o teste
     * unitário de `avisoSemTema` o prende nas duas horas.
     */
    const tituloEsperado = textosHoje.ramoNovoTitulo;
    const textoEsperado = textosHoje.ramoNovo;

    await page.goto("/criar/temas");
    await expect(page.getByText(tituloEsperado)).toBeVisible();
    await expect(page.getByText(textoEsperado, { exact: false })).toBeVisible();
    // "Escrever o meu assunto" continua, mesmo sem tema nenhum.
    await expect(page.getByRole("button", { name: "Escrever o meu assunto" })).toBeVisible();

    // "Contar o momento", em /criar, gera um roteiro normalmente mesmo sem tema do dia.
    await page.goto("/criar");
    await page.getByRole("button", { name: "Contar o momento" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("no escritorio, hora do almoco");
    await folha.getByLabel("O que está acontecendo").fill("organizando os recibos do mes de um cliente");
    await folha.getByLabel("O que dá para mostrar").fill("a planilha e a pilha de notas fiscais");
    await folha.getByRole("radio", { name: "Mais gente me conhecer" }).click();

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/, { timeout: 15_000 });
  });
});
