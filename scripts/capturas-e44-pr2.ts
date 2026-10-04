/**
 * Capturas da E44 PR 2 (os tipos de vídeo e o cabeçalho de vidro), a 390 e 1280, claro e escuro: o cartão no fim do Começar (padrões e três trocas), o Briefing, a Conta
 * (o cartão e a folha), o admin (a linha e a folha com o ajuste por cima), o selo nas Referências e no roteiro, e o cabeçalho de vidro no topo e rolado. Nenhum dado de cliente:
 * a marca é a do seed, mais uma de captura criada aqui (briefing até o bloco 4, para o Começar abrir no bloco 5).
 *
 * Pré-requisitos: os de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` ou `npm run start` na porta de
 * `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e44-pr2.ts <nome-da-pasta>` (ex.: "pr-119").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { perguntasDoBloco } from "../src/config/briefing";
import { db, getPool } from "../src/db";
import { account, briefings, clientes, contas, formatosDaMarca, membrosMarca, nichos, preferenciasUsuario, roteiros, user, videos, type AvaliacaoResposta } from "../src/db/schema";

const SENHA = "ExemploSenha123";
const SEED = "seed-cliente-limpeza@exemplo.teste";
const ADMIN = "admin@exemplo.teste";
const CAPTURA_ID = "captura-tipos";
const CAPTURA = `${CAPTURA_ID}@exemplo.teste`;

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];
const LARGURAS = [
  { largura: 390, altura: 844, celular: true },
  { largura: 1280, altura: 900, celular: false },
];

async function entrar(page: Page, base: string, email: string): Promise<void> {
  await page.goto(`${base}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
}

async function prepararBanco(): Promise<{ marcaId: number; roteiroId: number; seedMarcaId: number }> {
  const [limpeza] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
  await db().delete(user).where(eq(user.id, CAPTURA_ID));
  await db().insert(user).values({ id: CAPTURA_ID, name: "Captura", email: CAPTURA });
  await db().insert(account).values({ id: `${CAPTURA_ID}-c`, issuer: "local:credential", accountId: CAPTURA_ID, providerId: "credential", userId: CAPTURA_ID, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: CAPTURA_ID, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId: CAPTURA_ID, nome: "[exemplo] Captura", nichoId: limpeza.id, alcance: "brasil" }).returning();
  await db().insert(membrosMarca).values({ usuarioId: CAPTURA_ID, clienteId: marca.id, papel: "dono" });
  const avaliacoes: Record<string, AvaliacaoResposta> = {};
  const respostas: Record<string, string> = {};
  for (let bloco = 1; bloco <= 4; bloco++) {
    for (const p of perguntasDoBloco(bloco, "negocio")) {
      avaliacoes[p.id] = { nota: 9, bom: "ok", melhorar: "ok", como: "ok", impacto: "ok" };
      respostas[p.id] = "uma resposta de exemplo";
    }
  }
  await db().insert(briefings).values({ clienteId: marca.id, respostas, avaliacoes, notaGeral: "7.00", completo: false });

  const [seedMarca] = await db().select().from(clientes).where(eq(clientes.usuarioId, "seed-cliente-limpeza"));
  await db().delete(formatosDaMarca).where(eq(formatosDaMarca.clienteId, seedMarca.id));
  await db().insert(formatosDaMarca).values([
    { clienteId: seedMarca.id, chave: "opiniao_direta", ligada: true, quem: "cliente" },
    { clienteId: seedMarca.id, chave: "teste_ou_desafio", ligada: true, quem: "cliente" },
    { clienteId: seedMarca.id, chave: "lista", ligada: false, quem: "cliente" },
    { clienteId: seedMarca.id, chave: "bastidor", ligada: false, quem: "admin" },
  ]);
  const [conta] = await db().insert(contas).values({ plataforma: "tiktok", handle: `captura-${Date.now()}`, nichoId: limpeza.id }).returning();
  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno: `captura-${Date.now()}`,
      url: "https://exemplo.invalido/captura",
      contaId: conta.id,
      nichoId: limpeza.id,
      titulo: "o erro que faz a mancha voltar",
      views: 500000,
      publicadoEm: new Date(),
      foraDaCurva: "9",
      idioma: "pt",
      analise: { assunto: "a", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" } as never,
      formatoCatalogo: "erro_comum",
      serveDeModelo: true,
      tipoConteudo: "original",
    })
    .returning();
  const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.clienteId, seedMarca.id)).limit(1);
  if (roteiro) await db().update(roteiros).set({ referenciaVideoId: video.id }).where(eq(roteiros.id, roteiro.id));
  return { marcaId: marca.id, roteiroId: roteiro?.id ?? 0, seedMarcaId: seedMarca.id };
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e44-pr2.ts <nome-da-pasta> (ex.: "pr-119")');
    process.exitCode = 1;
    return;
  }
  const base = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pasta = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pasta, { recursive: true });
  const { marcaId, roteiroId, seedMarcaId } = await prepararBanco();

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      for (const tela of LARGURAS) {
        const nome = (grupo: string, estado: string) => path.join(pasta, `${grupo}.${estado}.${tela.largura}.${modo.rotulo}.png`);
        const ctx = await browser.newContext({ viewport: { width: tela.largura, height: tela.altura }, colorScheme: modo.colorScheme, isMobile: tela.celular, hasTouch: tela.celular });
        const page = await ctx.newPage();
        const foto = async (grupo: string, estado: string, inteira = false) => {
          const arquivo = nome(grupo, estado);
          await page.screenshot({ path: arquivo, fullPage: inteira });
          gravados.push(arquivo);
        };

        // O Começar no bloco 5: o cartão dos tipos, nos padrões e depois com três trocas.
        await db().delete(formatosDaMarca).where(eq(formatosDaMarca.clienteId, marcaId));
        await entrar(page, base, CAPTURA);
        await page.goto(`${base}/comecar`);
        await assentar(page);
        const cartao = page.getByRole("heading", { name: "Que tipos de vídeo combinam com você?" });
        await cartao.scrollIntoViewIfNeeded();
        await foto("Comecar", "TiposPadrao");
        const lista = page.getByRole("list", { name: "Tipos de vídeo" }).first();
        await lista.getByRole("switch", { name: "Opinião direta" }).click();
        await lista.getByRole("switch", { name: "Teste ou desafio" }).click();
        await lista.getByRole("switch", { name: "Lista" }).click();
        await page.waitForTimeout(500);
        await foto("Comecar", "TiposTrocados");
        await ctx.clearCookies();

        // Briefing, Conta, Referências e roteiro, na marca do seed (com as trocas do cliente e a do admin).
        await entrar(page, base, SEED);
        await page.goto(`${base}/briefing`);
        await assentar(page);
        await page.locator("#tipos-video").scrollIntoViewIfNeeded();
        await foto("Briefing", "Tipos");

        await page.goto(`${base}/conta`);
        await assentar(page);
        await foto("Conta", "CartaoTipos");
        await page.getByRole("button", { name: /Tipos de vídeo/ }).click();
        await page.waitForTimeout(700);
        await foto("Conta", "FolhaTipos");

        await page.goto(`${base}/referencias?periodo=90`);
        await assentar(page);
        await foto("Referencias", "SeloDoTipo");
        if (roteiroId) {
          await page.goto(`${base}/roteiros/${roteiroId}`);
          await assentar(page);
          await foto("Roteiro", "SeloDoTipo");
        }

        if (tela.celular) {
          // O cabeçalho de vidro: no topo e rolado (Conta, que usa o cabeçalho genérico).
          await page.goto(`${base}/conta`);
          await assentar(page);
          await page.addStyleTag({ content: "body { padding-bottom: 1600px !important; }" });
          await foto("Cabecalho", "VidroTopo");
          await page.evaluate(() => window.scrollTo(0, 320));
          await page.waitForTimeout(500);
          await foto("Cabecalho", "VidroRolado");
        }
        await ctx.clearCookies();

        // O admin: a linha em Ajustes e a folha com as treze.
        await entrar(page, base, ADMIN);
        await page.goto(`${base}/admin/clientes/${seedMarcaId}`);
        await assentar(page);
        const ajustar = page.getByRole("button", { name: "Ver e ajustar" });
        await ajustar.scrollIntoViewIfNeeded();
        await foto("Admin", "LinhaTipos");
        await ajustar.click();
        await page.waitForTimeout(700);
        await foto("Admin", "FolhaTipos");
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await getPool().end();
  }
  for (const arquivo of gravados) console.log(arquivo);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
