/**
 * Trocar de marca pela tela (V3, item 3 e definição de pronto do
 * `PROXIMO.md`): entrar, ver a pílula da marca ativa, abrir "Suas marcas",
 * trocar, ver o Hoje da outra marca, recarregar e continuar nela. Mais o
 * teste de duas pessoas na mesma marca vendo o mesmo roteiro, complemento em
 * UI do teste de isolamento de integração (`tests/integracao/
 * isolamento.test.ts`, "V3, item 2").
 *
 * Roteiro próprio ("e2e-marcas"), sem `resetarSchema` (mesma lição de
 * `roteiro.spec.ts` e `layout.spec.ts`): o seed roda uma vez só, no
 * globalSetup.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { inArray } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  temasDia,
  user,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { textosNav } from "../../src/textos/nav";

const SLUGS_NICHO = ["e2e-marcas-um", "e2e-marcas-dois"];
const IDS_USUARIO = ["e2e-marcas-a", "e2e-marcas-b"];

const SENHA = "ExemploSenha123";
const EMAIL_A = "e2e-marcas-a@exemplo.teste";
const EMAIL_B = "e2e-marcas-b@exemplo.teste";
const NOME_MARCA_UM = "[teste] Marca Um";
const NOME_MARCA_DOIS = "[teste] Marca Dois";
const NOME_MARCA_COMPARTILHADA = "[teste] Marca Compartilhada";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

function briefingCompletoExemplo() {
  return {
    completo: true as const,
    perfil: {
      fatos: {
        oQueVende: "kit tira-mancha para estofados",
        preco: "kit a partir de 89 reais",
        clienteIdeal: "mora em apartamento",
        medos: [],
        frasesDaFala: [],
        proibicoes: [],
        cenasFilmaveis: [],
        concorrentes: [],
        perfisAdmirados: [],
      },
      resumo: "marca propria de produtos de limpeza",
      referencias: [],
    },
  };
}

let roteiroCompartilhadoId: number;

test.describe("trocar de marca pela tela", () => {
  test.beforeAll(async () => {
    // Idempotente (achado da revisao do PR #47: no retry do CI, a segunda
    // tentativa quebrava em "nichos_slug_unique" e nunca testava nada de
    // verdade, escondendo se a falha da primeira era intermitente). Apagar o
    // usuario cascateia clientes, membros_marca e preferencias_usuario
    // (onDelete: cascade nessas FKs, schema.ts), mas nem toda FK para
    // clientes.id ou nichos.id cascateia (achado rodando `--repeat-each`,
    // uma rodada de cada vez: primeiro "briefings_cliente_id...", depois
    // "temas_dia_nicho_id..."); as duas apagadas a mao antes, pelo id das
    // marcas e nichos que este arquivo criou.
    const marcasExistentes = await db()
      .select({ id: clientes.id })
      .from(clientes)
      .where(inArray(clientes.usuarioId, IDS_USUARIO));
    const idsMarcasExistentes = marcasExistentes.map((m) => m.id);
    if (idsMarcasExistentes.length > 0) {
      await db().delete(roteiros).where(inArray(roteiros.clienteId, idsMarcasExistentes));
      await db().delete(briefings).where(inArray(briefings.clienteId, idsMarcasExistentes));
    }
    await db().delete(user).where(inArray(user.id, IDS_USUARIO));

    const nichosExistentes = await db()
      .select({ id: nichos.id })
      .from(nichos)
      .where(inArray(nichos.slug, SLUGS_NICHO));
    const idsNichosExistentes = nichosExistentes.map((n) => n.id);
    if (idsNichosExistentes.length > 0) {
      await db().delete(temasDia).where(inArray(temasDia.nichoId, idsNichosExistentes));
    }
    await db().delete(nichos).where(inArray(nichos.slug, SLUGS_NICHO));

    const [nichoUm] = await db()
      .insert(nichos)
      .values({ slug: "e2e-marcas-um", nome: "[teste] Marcas Um" })
      .returning();
    const [nichoDois] = await db()
      .insert(nichos)
      .values({ slug: "e2e-marcas-dois", nome: "[teste] Marcas Dois" })
      .returning();

    await db().insert(user).values({ id: "e2e-marcas-a", name: "[teste] Marcas A", email: EMAIL_A });
    await db()
      .insert(account)
      .values({
        id: "e2e-marcas-a-credential",
        issuer: "local:credential",
        accountId: "e2e-marcas-a",
        providerId: "credential",
        userId: "e2e-marcas-a",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-marcas-a", aceitouTermosEm: new Date() });

    // Marca Compartilhada e Marca Dois primeiro, Marca Um por ultimo:
    // marcaPadrao desempata por criadoEm desc (servicos/clientes.ts), entao a
    // Um e a marca ativa no primeiro login, sem cookie nenhum ainda. A
    // Compartilhada fica de fora do teste de troca (item abaixo): tem
    // roteiro de hoje, e /hoje mostraria "seu roteiro esta pronto" em vez do
    // seletor de tema se ela fosse a Um ou a Dois.
    const [marcaCompartilhada] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-marcas-a", nome: NOME_MARCA_COMPARTILHADA, nichoId: nichoUm.id })
      .returning();
    await db()
      .insert(membrosMarca)
      .values({ usuarioId: "e2e-marcas-a", clienteId: marcaCompartilhada.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: marcaCompartilhada.id, ...briefingCompletoExemplo() });

    const [marcaDois] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-marcas-a", nome: NOME_MARCA_DOIS, nichoId: nichoDois.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-marcas-a", clienteId: marcaDois.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: marcaDois.id, ...briefingCompletoExemplo() });

    const [marcaUm] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-marcas-a", nome: NOME_MARCA_UM, nichoId: nichoUm.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-marcas-a", clienteId: marcaUm.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: marcaUm.id, ...briefingCompletoExemplo() });

    const temaUm: TemaDoDia[] = [
      {
        titulo: "tema exclusivo da marca um",
        descricao: "descricao do tema",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "alcance",
      },
    ];
    await db().insert(temasDia).values({ nichoId: nichoUm.id, data: hojeISO(), temas: temaUm });

    const temaDois: TemaDoDia[] = [
      {
        titulo: "tema exclusivo da marca dois",
        descricao: "descricao do tema",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [],
        puxaPara: "engajamento",
      },
    ];
    await db().insert(temasDia).values({ nichoId: nichoDois.id, data: hojeISO(), temas: temaDois });

    const conteudo: ConteudoRoteiro = {
      titulo: "o roteiro compartilhado da marca",
      duracaoS: 30,
      gancho: "todo mundo erra isso na hora de tirar mancha",
      corpo: "explique o passo a passo na ordem certa.",
      fechamento: "mostre o resultado",
      chamadaFinal: "manda mensagem se quiser saber qual produto",
      cenas: [{ momento: "abertura", oQueFazer: "mostrar a mancha" }],
      ondeGravar: "na sala",
      edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
      evidencias: [],
      semEvidencia: true,
    };
    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: marcaCompartilhada.id,
        data: hojeISO(),
        tema: conteudo.titulo,
        origem: "sugerido",
        objetivo: "conversao",
        conteudo,
      })
      .returning();
    roteiroCompartilhadoId = roteiro.id;

    // Pessoa B: so membro da Marca Compartilhada, para o teste de duas pessoas vendo o mesmo roteiro.
    await db().insert(user).values({ id: "e2e-marcas-b", name: "[teste] Marcas B", email: EMAIL_B });
    await db()
      .insert(account)
      .values({
        id: "e2e-marcas-b-credential",
        issuer: "local:credential",
        accountId: "e2e-marcas-b",
        providerId: "credential",
        userId: "e2e-marcas-b",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-marcas-b", aceitouTermosEm: new Date() });
    await db()
      .insert(membrosMarca)
      .values({ usuarioId: "e2e-marcas-b", clienteId: marcaCompartilhada.id, papel: "membro" });
  });

  // O pool do Postgres fecha uma vez so, no globalTeardown (playwright.config.ts).

  test("entra, ve a pilula, abre Suas marcas, troca, ve o Hoje da outra marca, recarrega e continua nela", async ({
    page,
  }) => {
    // A pilula (SeletorMarcaCelular) so existe abaixo de 768px; do tablet
    // para cima quem mostra a troca de marca e o pe da barra lateral
    // (SeletorMarcaDesktop, coberto nas tres larguras em `layout.spec.ts`).
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, EMAIL_A);

    // Marca Um e a ativa no primeiro login (criadoEm desc, sem cookie ainda).
    const pilula = page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_UM) });
    await expect(pilula).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema exclusivo da marca um" })).toBeVisible();

    await pilula.click();
    const folha = page.getByRole("dialog", { name: textosNav.suasMarcas });
    await expect(folha).toBeVisible();
    await expect(folha.getByText(NOME_MARCA_UM)).toBeVisible();

    await folha.getByRole("button", { name: NOME_MARCA_DOIS }).click();

    // O Hoje da outra marca: o tema exclusivo da Um some, o da Dois aparece.
    await expect(page.getByRole("heading", { name: "tema exclusivo da marca dois" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "tema exclusivo da marca um" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) })).toBeVisible();

    // Recarrega e continua na marca trocada (cookie assinado, nao estado de tela).
    await page.reload();
    await expect(page.getByRole("heading", { name: "tema exclusivo da marca dois" })).toBeVisible();
    await expect(page.getByRole("button", { name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_DOIS) })).toBeVisible();
  });

  test("duas pessoas na mesma marca veem o mesmo roteiro", async ({ page, browser }) => {
    await entrar(page, EMAIL_A);
    // Pessoa A e membro de tres marcas; qual delas esta ativa depende da
    // ordem dos testes anteriores (marcaPadrao usa o ultimo acesso). Troca
    // para a Compartilhada pelo seletor de desktop (viewport padrao, sem
    // setViewportSize) antes de abrir o roteiro, que so e visivel na marca
    // ativa (`roteiroPorId(id, cliente.id)`, escopado por marca).
    await page.getByRole("button", { name: /^Trocar de marca/ }).click();
    const itemCompartilhada = page.getByRole("menuitemradio", { name: NOME_MARCA_COMPARTILHADA });
    await itemCompartilhada.click();
    const botaoSeletor = page.getByRole("button", {
      name: textosNav.trocarDeMarcaRotulo(NOME_MARCA_COMPARTILHADA),
    });
    await expect(botaoSeletor).toBeVisible();
    // O nome no botao muda otimista, antes da troca terminar no servidor
    // (useTrocarMarca.ts, marcaAlvo); esperar reabilitar confirma que a
    // transicao React terminou de verdade (cookie ja gravado), sem
    // depender de um timeout maior nem da rede ficar ociosa.
    await expect(botaoSeletor).toBeEnabled();

    await page.goto(`/roteiros/${roteiroCompartilhadoId}`);
    await expect(
      page.getByRole("heading", { name: "o roteiro compartilhado da marca", level: 1 }),
    ).toBeVisible();

    const contextoB = await browser.newContext();
    const paginaB = await contextoB.newPage();
    await entrar(paginaB, EMAIL_B);
    await paginaB.goto(`/roteiros/${roteiroCompartilhadoId}`);
    await expect(
      paginaB.getByRole("heading", { name: "o roteiro compartilhado da marca", level: 1 }),
    ).toBeVisible();
    await contextoB.close();
  });
});
