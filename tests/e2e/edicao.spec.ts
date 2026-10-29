/**
 * E47 PR 2, subir e guardar o vídeo da pessoa, pelo servidor de verdade (`next start`) com a sessão de verdade e um vídeo SINTÉTICO gerado aqui com o ffmpeg (nenhum vídeo de ninguém). Prova, pelo
 * que a pessoa recebe: abrir a edição, subir o vídeo, o vídeo guardado no volume de edição e conferido (duração, tamanho da imagem), o 4K recusado com a frase em língua de gente (e nada no disco),
 * a marca de fora que não enxerga nem envia na edição dos outros, e a rota fechada para quem não entrou. A transcrição é do worker e tem a própria prova (`tests/integracao/edicao.test.ts`, com a
 * Groq falsa): o e2e não sobe worker.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, edicoes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, type ConteudoRoteiro } from "../../src/db/schema";
import { fraseDaEdicao } from "../../src/textos/edicao";

const SENHA = "ExemploSenha123";
const DONO = "e2e-edicao-dono";
const DONO_EMAIL = "dono-e2e-edicao@exemplo.teste";
const OUTRO = "e2e-edicao-outro";
const OUTRO_EMAIL = "outro-e2e-edicao@exemplo.teste";

/** A pasta do volume de edição do servidor do e2e: a mesma que `playwright.config.ts` passa ao `next start`. */
const VOLUME = process.env.EDICAO_PASTA ?? "";

let marca: number;
let marcaDeFora: number;
let roteiroId: number;
let pastaDosVideos: string;
let bom: Buffer;
let quatroK: Buffer;

const CONTEUDO: ConteudoRoteiro = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 30,
  gancho: "O terceiro erro é o que mais estraga o copo.",
  corpo: "Quase sempre sobra detergente no fundo.",
  fechamento: "Enxágue sempre com água morna.",
  chamadaFinal: "Chame no WhatsApp e peça o seu orçamento.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na sua cozinha",
  edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

function ffmpeg(...args: string[]): void {
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", ...args], { stdio: "pipe" });
}

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|comecar)/);
}

async function criarPessoa(id: string, email: string, nome: string): Promise<void> {
  await db().delete(user).where(eq(user.id, id));
  await db().insert(user).values({ id, name: nome, email });
  await db().insert(account).values({ id: `${id}-c`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
}

function arquivosDoVolume(): string[] {
  const todos: string[] = [];
  for (const sub of ["bruto", "editado"]) {
    if (existsSync(join(VOLUME, sub))) for (const nome of readdirSync(join(VOLUME, sub))) todos.push(`${sub}/${nome}`);
  }
  return todos.sort();
}

test.describe("Editar o meu vídeo: subir e guardar", () => {
  test.beforeAll(async () => {
    expect(VOLUME, "EDICAO_PASTA precisa vir do playwright.config.ts").not.toBe("");
    pastaDosVideos = mkdtempSync(join(tmpdir(), "edicao-e2e-"));
    const imagem = (tamanho: string, taxa: number) => ["-f", "lavfi", "-i", `testsrc2=size=${tamanho}:rate=${taxa}`];
    const som = ["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=16000"];
    const codecs = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"];
    ffmpeg(...imagem("360x640", 15), ...som, "-t", "6", ...codecs, join(pastaDosVideos, "bom.mp4"));
    ffmpeg(...imagem("2160x3840", 2), ...som, "-t", "4", ...codecs, join(pastaDosVideos, "quatro-k.mp4"));
    bom = readFileSync(join(pastaDosVideos, "bom.mp4"));
    quatroK = readFileSync(join(pastaDosVideos, "quatro-k.mp4"));

    const [nicho] = await db().select().from(nichos).limit(1);
    await criarPessoa(DONO, DONO_EMAIL, "Dona Edicao E2E");
    await criarPessoa(OUTRO, OUTRO_EMAIL, "Outra Marca E2E");
    const [a, b] = await db()
      .insert(clientes)
      .values([
        { nome: "[teste e2e] Marca que edita", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" },
        { nome: "[teste e2e] Marca de fora da edicao", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" },
      ])
      .returning();
    marca = a.id;
    marcaDeFora = b.id;
    await db().insert(membrosMarca).values([
      { usuarioId: DONO, clienteId: marca, papel: "dono" },
      { usuarioId: OUTRO, clienteId: marcaDeFora, papel: "dono" },
    ]);
    await db().insert(briefings).values([
      { clienteId: marca, completo: true },
      { clienteId: marcaDeFora, completo: true },
    ]);
  });

  test.afterAll(async () => {
    await db().delete(edicoes).where(inArray(edicoes.clienteId, [marca, marcaDeFora]));
    await db().delete(roteiros).where(inArray(roteiros.clienteId, [marca, marcaDeFora]));
    rmSync(pastaDosVideos, { recursive: true, force: true });
    rmSync(VOLUME, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    await db().delete(edicoes).where(inArray(edicoes.clienteId, [marca, marcaDeFora]));
    await db().delete(roteiros).where(inArray(roteiros.clienteId, [marca, marcaDeFora]));
    rmSync(VOLUME, { recursive: true, force: true });
    const [r] = await db()
      .insert(roteiros)
      .values({ clienteId: marca, data: "2026-10-29", tema: "louça", origem: "livre", objetivo: "alcance", formato: "reels", estilo: "falado", conteudo: CONTEUDO })
      .returning({ id: roteiros.id });
    roteiroId = r.id;
  });

  test("abre a edição, sobe o vídeo, ele fica guardado no volume e conferido, e a pessoa vê o estado", async ({ page }) => {
    await entrar(page, DONO_EMAIL);
    const aberta = await page.request.post("/api/edicao", { data: { roteiroId, tamanhoBytes: bom.byteLength, tipoDoArquivo: "video/mp4", nomeDoArquivo: "meu-video.mp4" } });
    expect(aberta.status()).toBe(200);
    const { id, usadas, limite } = (await aberta.json()) as { id: number; usadas: number; limite: number };
    expect([usadas, limite]).toEqual([1, 30]);

    const antes = await page.request.get(`/api/edicao/${id}`);
    expect(await antes.json()).toMatchObject({ id, estado: "subindo" });

    const enviada = await page.request.put(`/api/edicao/${id}/video`, { data: bom, headers: { "content-type": "video/mp4" } });
    expect(enviada.status()).toBe(200);
    expect(await enviada.json()).toEqual({ ok: true });

    const depois = await (await page.request.get(`/api/edicao/${id}`)).json();
    expect(depois).toMatchObject({ id, estado: "guardado", largura: 360, altura: 640, uso: { usadas: 1, limite: 30 } });
    expect(depois.duracaoS).toBeGreaterThan(5.5);
    expect(depois.duracaoS).toBeLessThan(6.5);
    expect(new Date(depois.brutoExpiraEm).getTime() - Date.now()).toBeGreaterThan(47 * 3_600_000);

    // O arquivo está no volume, inteiro.
    expect(arquivosDoVolume()).toEqual([`bruto/ed-${id}.video`]);
    expect(readFileSync(join(VOLUME, "bruto", `ed-${id}.video`)).byteLength).toBe(bom.byteLength);
  });

  test("um vídeo em 4K é recusado com a frase em língua de gente e não fica nada no disco", async ({ page }) => {
    await entrar(page, DONO_EMAIL);
    const aberta = await page.request.post("/api/edicao", { data: { roteiroId, tamanhoBytes: quatroK.byteLength, tipoDoArquivo: "video/mp4", nomeDoArquivo: "4k.mp4" } });
    const { id } = (await aberta.json()) as { id: number };
    const enviada = await page.request.put(`/api/edicao/${id}/video`, { data: quatroK, headers: { "content-type": "video/mp4" } });
    expect(enviada.status()).toBe(422);
    const corpo = (await enviada.json()) as { erro: string; codigo: string };
    expect(corpo).toEqual({ erro: fraseDaEdicao("qualidade-alta"), codigo: "qualidade-alta" });
    expect(corpo.erro).toContain("HD (1080p)");
    expect(arquivosDoVolume()).toEqual([]);
    expect(await (await page.request.get(`/api/edicao/${id}`)).json()).toMatchObject({ estado: "falhou", motivo: fraseDaEdicao("qualidade-alta"), uso: { usadas: 0 } });
  });

  test("a marca de fora não vê nem envia na edição dos outros, e quem não entrou não abre nada", async ({ page, browser, baseURL }) => {
    await entrar(page, DONO_EMAIL);
    const aberta = await page.request.post("/api/edicao", { data: { roteiroId, tamanhoBytes: bom.byteLength, tipoDoArquivo: "video/mp4" } });
    const { id } = (await aberta.json()) as { id: number };

    const contexto = await browser.newContext({ baseURL });
    const paginaDeFora = await contexto.newPage();
    await entrar(paginaDeFora, OUTRO_EMAIL);
    expect((await paginaDeFora.request.get(`/api/edicao/${id}`)).status()).toBe(404);
    expect((await paginaDeFora.request.put(`/api/edicao/${id}/video`, { data: bom, headers: { "content-type": "video/mp4" } })).status()).toBe(404);
    expect((await paginaDeFora.request.post("/api/edicao", { data: { roteiroId, tamanhoBytes: bom.byteLength, tipoDoArquivo: "video/mp4" } })).status()).toBe(404);
    expect(arquivosDoVolume()).toEqual([]);
    await contexto.close();

    // Sem cookie de sessão o middleware manda para a entrada (redirecionamento) e a rota, se chegasse a ser chamada, daria 401: nunca 200 nem dado.
    const semSessao = await browser.newContext({ baseURL });
    const recusou = (status: number) => status === 401 || (status >= 300 && status < 400);
    expect(recusou((await semSessao.request.get(`/api/edicao/${id}`, { maxRedirects: 0 })).status())).toBe(true);
    expect(recusou((await semSessao.request.put(`/api/edicao/${id}/video`, { data: bom, maxRedirects: 0 })).status())).toBe(true);
    expect(recusou((await semSessao.request.post("/api/edicao", { data: { roteiroId, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }, maxRedirects: 0 })).status())).toBe(true);
    await semSessao.close();

    expect(await (await page.request.get(`/api/edicao/${id}`)).json()).toMatchObject({ id, estado: "subindo" });
  });
});
