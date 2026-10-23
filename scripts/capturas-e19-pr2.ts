/**
 * Capturas da E19 PR 2 (o cartão "Seu Instagram" em Conta), cada estado, em 390 e 1280, claro e escuro. A Meta é SIMULADA (`tests/fixtures/meta-simulada.ts`): este script sobe o
 * servidor local que faz o papel do diálogo e da Graph API, e o aplicativo só fala com ele porque está de pé com `MODO_E2E=1` e `META_SIMULADOR_E2E`. Nenhuma chamada à Meta de verdade.
 * Nenhum dado de cliente: as pessoas e a marca são criadas aqui, com e-mail `.teste`, no banco apontado por `DATABASE_URL`.
 *
 * Pré-requisitos: `DATABASE_URL` de um banco de revisão (nunca `roteiros`), migrado e semeado (o `globalSetup` do Playwright faz isso); o app no ar em `CAPTURAS_URL` com o mesmo ambiente
 * do `webServer.env` do `playwright.config.ts` (MODO_E2E, META_*). Para a captura do estado "indisponível" o app precisa subir SEM os quatro dados da Meta: `--so-indisponivel`.
 *
 * Uso: `npx tsx scripts/capturas-e19-pr2.ts <pasta-de-saida> [--so-indisponivel]`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { account, briefings, clientes, contasConectadas, membrosMarca, nichos, preferenciasUsuario, user } from "../src/db/schema";
import { textosLigacao } from "../src/textos/conta-conectada";
import { iniciarMetaSimulada, type MetaSimulada } from "../tests/fixtures/meta-simulada";

const BASE = process.env.CAPTURAS_URL ?? "http://localhost:3195";
const SENHA = "ExemploSenha123";
const EMAIL_ADMIN = "admin@exemplo.teste";
const DONO = "cap-e19-dono";
const MEMBRO = "cap-e19-membro";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "claro", colorScheme: "light" as const },
  { rotulo: "escuro", colorScheme: "dark" as const },
];

let marca: number;

async function criarPessoa(id: string, nome: string): Promise<string> {
  const email = `${id}@exemplo.teste`;
  // Rodar de novo reaproveita a pessoa (o ver como deixa registro que impede apagá-la).
  const [existe] = await db().select({ id: user.id }).from(user).where(eq(user.id, id));
  if (existe) return email;
  await db().insert(user).values({ id, name: nome, email, role: "cliente" });
  await db().insert(account).values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
  return email;
}

async function prepararMarca(): Promise<void> {
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  await criarPessoa(DONO, "[exemplo] Dona do Instagram");
  await criarPessoa(MEMBRO, "[exemplo] Membro do Instagram");
  const [antiga] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.nome, "[exemplo] Capturas E19"));
  if (antiga) {
    marca = antiga.id;
    return;
  }
  // Sem o perfil do Instagram preenchido: com várias contas, nenhuma bate sozinha e a pessoa escolhe.
  const [c] = await db().insert(clientes).values({ nome: "[exemplo] Capturas E19", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" }).returning();
  marca = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: DONO, clienteId: marca, papel: "dono" },
    { usuarioId: MEMBRO, clienteId: marca, papel: "membro" },
  ]);
  await db().insert(briefings).values({ clienteId: marca, completo: true });
}

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/(hoje|comecar|admin)/);
  await page.waitForLoadState("networkidle");
}

async function limparContas(): Promise<void> {
  await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marca));
}

async function ligarNoBanco(extra: Partial<typeof contasConectadas.$inferInsert> = {}): Promise<void> {
  await db().insert(contasConectadas).values({
    clienteId: marca,
    plataforma: "instagram",
    contaId: "17841400000000101",
    nome: "casa.em.ordem",
    paginaNome: "Casa em Ordem",
    metaUsuarioId: "meta-pessoa-exemplo",
    estado: "ativa",
    tokenCifrado: "v1.so-para-a-captura",
    conectadoPor: DONO,
    conectadaEm: new Date("2026-10-12T15:30:00Z"),
    ...extra,
  });
}

function cartao(page: Page): Locator {
  return page.getByTestId("seu-instagram");
}

async function fotografar(page: Page, saida: string, nome: string, sufixo: string, pagina = false): Promise<void> {
  // A barra de baixo e o que mais é fixo ficam por cima do recorte do celular: esconde.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
  });
  await page.waitForTimeout(300);
  const arquivo = path.join(saida, `${nome}-${sufixo}.png`);
  if (pagina) await page.screenshot({ path: arquivo, fullPage: true });
  else {
    await cartao(page).scrollIntoViewIfNeeded();
    await cartao(page).screenshot({ path: arquivo });
  }
}

async function abrirConta(page: Page, consulta = ""): Promise<void> {
  await page.goto(`${BASE}/conta${consulta}`);
  await cartao(page).waitFor();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const saida = process.argv[2];
  const soIndisponivel = process.argv.includes("--so-indisponivel");
  if (!saida) {
    console.error("uso: npx tsx scripts/capturas-e19-pr2.ts <pasta-de-saida> [--so-indisponivel]");
    process.exitCode = 1;
    return;
  }
  await mkdir(saida, { recursive: true });
  await prepararMarca();
  const meta: MetaSimulada = await iniciarMetaSimulada(Number(process.env.PLAYWRIGHT_META_PORTA ?? 4747));
  const browser = await chromium.launch();
  try {
    for (const tamanho of TAMANHOS) {
      for (const modo of MODOS) {
        const sufixo = `${tamanho.rotulo}-${modo.rotulo}`;
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        meta.cenario = {};
        await limparContas();
        await entrar(page, `${DONO}@exemplo.teste`);

        if (soIndisponivel) {
          // O app subiu sem os dados da Meta: o cartão só explica, sem botão.
          await abrirConta(page);
          await fotografar(page, saida, "01-indisponivel", sufixo);
          await contexto.close();
          continue;
        }

        // Sem ligação: o convite, o que lemos, o que nunca fazemos e o aviso do grupo pequeno.
        await abrirConta(page);
        await fotografar(page, saida, "02-sem-ligacao", sufixo);

        // Cada frase da volta do diálogo, sem conta ligada.
        const ordem: [string, string][] = [
          ["03-volta-cancelou", "cancelou"],
          ["04-volta-venceu", "venceu"],
          ["05-volta-permissao", "permissao"],
          ["06-volta-sem-instagram", "sem-instagram"],
          ["07-volta-ja-ligada", "ja-ligada"],
          ["08-volta-falhou", "falhou"],
          ["09-volta-nao-configurada", "nao-configurada"],
          ["10-volta-sem-acesso", "sem-acesso"],
        ];
        for (const [nome, codigo] of ordem) {
          await abrirConta(page, `?instagram=${codigo}`);
          await cartao(page).locator(`[data-retorno="${codigo}"]`).waitFor();
          await fotografar(page, saida, nome, sufixo);
        }

        // O fluxo de verdade (contra a Meta simulada): ligada, com a faixa de "pronto".
        await abrirConta(page);
        await cartao(page).getByRole("link", { name: "Ligar o meu Instagram" }).click();
        await page.waitForURL(/\/conta/);
        await cartao(page).locator('[data-retorno="ligada"]').waitFor();
        await fotografar(page, saida, "11-ligada-recem-ligada", sufixo);
        await fotografar(page, saida, "11b-ligada-pagina-inteira", sufixo, true);

        // Ligada, sem leitura ainda (recarrega: a faixa da volta some); depois com leitura; depois com o problema guardado.
        await abrirConta(page);
        await fotografar(page, saida, "12-ligada-sem-leitura", sufixo);
        await db().update(contasConectadas).set({ ultimaLeituraEm: new Date("2026-10-22T09:20:00Z") }).where(eq(contasConectadas.clienteId, marca));
        await abrirConta(page);
        await fotografar(page, saida, "13-ligada-com-leitura", sufixo);

        // A pergunta de desligar.
        await cartao(page).getByRole("button", { name: "Desligar" }).click();
        await cartao(page).getByRole("alertdialog").waitFor();
        await fotografar(page, saida, "14-desligar-confirmacao", sufixo);

        for (const [nome, chave] of [
          ["15-erro-recusada", "recusada"],
          ["16-erro-sem-permissao", "semPermissao"],
          ["17-erro-nao-renovou", "naoRenovou"],
          ["18-erro-venceu", "venceu"],
          ["19-erro-ilegivel", "ilegivel"],
        ] as const) {
          await db().update(contasConectadas).set({ erro: textosLigacao.erroDaConta[chave], erroEm: new Date() }).where(eq(contasConectadas.clienteId, marca));
          await abrirConta(page);
          await fotografar(page, saida, nome, sufixo);
        }

        // Várias contas: a lista para escolher.
        await limparContas();
        meta.cenario = {
          contas: [
            { paginaId: "p1", paginaNome: "Casa em Ordem", igId: "17841400000000201", username: "casa.em.ordem" },
            { paginaId: "p2", paginaNome: "Casa em Ordem Sul", igId: "17841400000000202", username: "casa.em.ordem.sul" },
          ],
        };
        await page.goto(`${BASE}/api/meta/conectar`);
        await cartao(page).locator('[data-parte="candidatas"]').waitFor();
        await fotografar(page, saida, "20-escolher-varias-contas", sufixo);
        await abrirConta(page);
        await fotografar(page, saida, "21-escolher-sem-faixa-da-volta", sufixo);

        // Quem é só membro lê a conta, sem botão.
        await limparContas();
        await ligarNoBanco({ ultimaLeituraEm: new Date("2026-10-22T09:20:00Z") });
        await contexto.clearCookies();
        await entrar(page, `${MEMBRO}@exemplo.teste`);
        await abrirConta(page);
        await fotografar(page, saida, "22-membro-ligada", sufixo);
        await limparContas();
        await abrirConta(page);
        await fotografar(page, saida, "23-membro-sem-ligacao", sufixo);

        // O ver como: a dona vista pelo admin, com a conta ligada e com o problema guardado.
        await limparContas();
        await ligarNoBanco({ erro: textosLigacao.erroDaConta.naoRenovou, erroEm: new Date(), ultimaLeituraEm: new Date("2026-10-22T09:20:00Z") });
        await contexto.clearCookies();
        await entrar(page, EMAIL_ADMIN);
        await page.goto(`${BASE}/admin/clientes/${marca}`);
        await page.locator('[data-bloco="acesso"]').getByRole("button", { name: "Ver o painel como [exemplo] Dona do Instagram" }).click();
        await page.getByRole("dialog", { name: "Ver o painel como" }).getByRole("button", { name: "Ver como [exemplo] Dona do Instagram" }).click();
        await page.waitForURL(/\/hoje/);
        await abrirConta(page);
        await fotografar(page, saida, "24-ver-como", sufixo);

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await meta.fechar();
    await getPool().end();
  }
}

void main();
