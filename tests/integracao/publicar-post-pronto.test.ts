/**
 * E56 PR 2, publicar post pronto (imagem e carrossel) com fila, contra o Postgres local e SEM rede: a Graph API (graph.instagram.com) é simulada pelo `fetch`; o ffmpeg converte as imagens de verdade.
 * Prova: imagem única, carrossel de 10 (ordem dos filhos, legenda só no carrossel, uma publicação), recusa de 11, PNG convertido para JPEG, proporção e tipo recusados, o limite das 24 horas (a fila
 * espera e retoma), o isolamento entre marcas, só o dono, o "ver como" e o portão da cobrança, publicar uma vez só (reserva dupla, resposta perdida), a fila com intervalo, o cancelar e o repetir, o
 * endereço público da imagem (assinado, só enquanto publica) e que o acesso nunca vai para log, retorno nem tabela.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string; name: string }; session: { userId: string }; verComo: null | object },
  verComo: false,
  barrada: false,
  logs: [] as unknown[][],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return {
    ...original,
    sessaoDoPainel: async () => estado.sessao,
    recusaDoVerComo: async () => (estado.verComo ? "Desligado no modo ver como." : null),
    modoVerComoLigado: async () => estado.verComo,
  };
});
vi.mock("@/lib/portao-cobranca", async () => {
  const { NextResponse } = await import("next/server");
  return {
    exigirAssinaturaValida: async () => {
      if (estado.barrada) throw new Error("REDIRECT:/assinar");
    },
    recusaDaCobranca: async () => (estado.barrada ? NextResponse.json({ erro: "assinatura" }, { status: 402 }) : null),
  };
});
vi.mock("@/lib/log", () => {
  const guardar = (...args: unknown[]) => void estado.logs.push(args);
  return { logger: { info: guardar, warn: guardar, error: guardar, debug: guardar, trace: guardar, fatal: guardar } };
});

import { db, getPool } from "@/db";
import { clientes, contasConectadas, membrosMarca, nichos, postsProntos, user } from "@/db/schema";
import { config } from "@/lib/config";
import { caminhoDaImagem, enderecoPublicoDaImagem, pastaDoPost } from "@/lib/imagens-do-post";
import { cifrarToken, contextoDoToken } from "@/lib/meta-token";
import {
  cancelarPostPronto,
  criarPostPronto,
  ESPERA_APOS_O_LIMITE_MS,
  listarPostsDaMarca,
  publicarPost,
  repetirPostPronto,
  rodarFilaDePosts,
  varrerImagensDosPosts,
} from "@/servicos/post-pronto";
import { FRASE_DE_VIDEO, importarPostsDaPasta, lerLegendas, lerPastaDePosts, recusaDoLote } from "@/servicos/post-pronto-lote";
import { fraseDeFalhaDoPost, fraseDeRecusaDoPost } from "@/textos/post-pronto";

import { resetarSchema } from "../../scripts/resetar-schema";

const { POST: montarRota } = await import("@/app/api/posts-prontos/route");
const { GET: baixarImagem, HEAD: cabecalhosDaImagem } = await import("@/app/api/publicar-arquivo/imagem/[codigo]/[nome]/route");
const { cancelarPostAction, repetirPostAction } = await import("@/app/(painel)/(completo)/publicar-post/acoes");

const executar = promisify(execFile);
const TOKEN_A = "IGQ-TOKEN-POST-MARCA-A-NUNCA-NO-BANCO";
const TOKEN_B = "IGQ-TOKEN-POST-MARCA-B-NUNCA-NO-BANCO";
const TOKENS = [TOKEN_A, TOKEN_B];
const IG_A = "17841400000000a11";
const IG_B = "17841400000000b11";
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let marcaA: number;
let marcaB: number;
let pasta: string;
let pastaDeImagens: string;

// ---------------------------------------------------------------------------
// O Instagram simulado
// ---------------------------------------------------------------------------

type Cenario = {
  status?: string[];
  erroNoContainer?: { code: number; subcode?: number };
  erroAoPublicar?: { code: number; subcode?: number } | { http: number } | "rede";
  limite?: { usadas: number; total: number | null };
  demoraNoPublicar?: number;
};
type Chamada = { tipo: "container" | "status" | "publicar" | "permalink" | "limite" | "outra"; host: string; metodo: string; caminho: string; token: string; corpo: Record<string, string> };
const chamadas: Chamada[] = [];
/** O que a Meta "baixou" ao receber cada image_url: o status e os dois primeiros bytes. */
const baixadas: { url: string; status: number; inicio: number[]; tipo: string | null }[] = [];
let sequencia = 0;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function instalarInstagram(c: Cenario = {}): void {
  sequencia = 0;
  let perguntas = 0;
  mockFetch.mockImplementation(async (entrada: URL | string, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? "GET";
    const corpo: Record<string, string> = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
    const caminho = url.pathname.replace(/^\/v26\.0\//, "");
    const token = corpo.access_token ?? url.searchParams.get("access_token") ?? "";
    const registro = (tipo: Chamada["tipo"]) => chamadas.push({ tipo, host: url.host, metodo, caminho, token, corpo });
    if (url.host !== "graph.instagram.com") {
      registro("outra");
      return json({ error: { message: "so o graph.instagram.com devia ser chamado", code: 1 } }, 400);
    }
    if (metodo === "POST" && caminho.endsWith("/media")) {
      registro("container");
      if (c.erroNoContainer) return json({ error: { message: "erro simulado", code: c.erroNoContainer.code, error_subcode: c.erroNoContainer.subcode } }, 400);
      if (corpo.image_url) {
        // A Meta baixa a imagem do endereço público, sem cookie.
        const u = new URL(corpo.image_url);
        const partes = u.pathname.split("/");
        const resposta = await baixarImagem(new Request(u), { params: Promise.resolve({ codigo: decodeURIComponent(partes[4] ?? ""), nome: partes[5] ?? "01.jpg" }) });
        const bytes = resposta.status === 200 ? new Uint8Array(await resposta.arrayBuffer()) : new Uint8Array();
        baixadas.push({ url: corpo.image_url, status: resposta.status, inicio: [...bytes.slice(0, 3)], tipo: resposta.headers.get("content-type") });
      }
      sequencia += 1;
      return json({ id: `container-img-${sequencia}` });
    }
    if (metodo === "POST" && caminho.endsWith("/media_publish")) {
      registro("publicar");
      if (c.demoraNoPublicar) await new Promise((r) => setTimeout(r, c.demoraNoPublicar));
      if (c.erroAoPublicar === "rede") throw new TypeError("fetch failed");
      if (c.erroAoPublicar && typeof c.erroAoPublicar === "object" && "http" in c.erroAoPublicar) return new Response("<html>Bad Gateway</html>", { status: c.erroAoPublicar.http, headers: { "content-type": "text/html" } });
      if (c.erroAoPublicar) return json({ error: { message: "erro simulado", code: c.erroAoPublicar.code, error_subcode: c.erroAoPublicar.subcode } }, 400);
      return json({ id: `midia-post-${chamadas.filter((x) => x.tipo === "publicar").length}` });
    }
    if (caminho.endsWith("/content_publishing_limit")) {
      registro("limite");
      const limite = c.limite ?? { usadas: 2, total: 50 };
      return json({ data: [{ quota_usage: limite.usadas, ...(limite.total === null ? {} : { config: { quota_total: limite.total } }) }] });
    }
    if (url.searchParams.get("fields") === "status_code") {
      registro("status");
      const lista = c.status ?? ["FINISHED"];
      const item = lista[Math.min(perguntas, lista.length - 1)];
      perguntas += 1;
      return json({ status_code: item, id: caminho });
    }
    if (url.searchParams.get("fields") === "permalink") {
      registro("permalink");
      return json({ permalink: `https://www.instagram.com/p/POST${chamadas.filter((x) => x.tipo === "publicar").length}/`, id: caminho });
    }
    registro("outra");
    return json({ error: { message: "caminho desconhecido do simulador", code: 100 } }, 404);
  });
}

const dasChamadas = (tipo: Chamada["tipo"]) => chamadas.filter((c) => c.tipo === tipo);

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

/** Gera uma imagem de verdade pelo ffmpeg (a mesma ferramenta que converte no servidor). */
async function gerarImagem(largura: number, altura: number, formato: "png" | "jpg" = "png", cor = "blue"): Promise<Uint8Array> {
  const arquivo = join(pastaDeImagens, `${cor}-${largura}x${altura}-${Math.random().toString(36).slice(2)}.${formato}`);
  await executar("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${cor}:s=${largura}x${altura}`, "-frames:v", "1", arquivo]);
  return new Uint8Array(readFileSync(arquivo));
}

const ehJpeg = (b: Uint8Array | Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

async function ligarContaDoInstagram(o: { clienteId: number; igId: string; token: string; nome: string }) {
  await db()
    .insert(contasConectadas)
    .values({
      clienteId: o.clienteId,
      plataforma: "instagram",
      via: "instagram",
      contaId: o.igId,
      nome: o.nome,
      metaUsuarioId: `meta-${o.clienteId}`,
      estado: "ativa",
      tokenCifrado: cifrarToken(o.token, contextoDoToken(o.clienteId, "instagram", o.igId)),
      tokenExpiraEm: new Date(Date.now() + 90 * 24 * 3600 * 1000),
      publicarLiberado: true,
      conectadaEm: new Date("2026-10-01T00:00:00Z"),
    });
}

function entrar(usuarioId: string | null): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: "cliente", name: usuarioId }, session: { userId: usuarioId }, verComo: null } : null;
}

const semEspera = async () => undefined;
const minutos = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);
/** O relógio das chamadas começa agora de verdade (o código assinado do endereço é conferido pela rota com o relógio real). */
let inicio: Date;
const deps = (agora: Date = inicio, agendar = vi.fn(async () => undefined)) => ({ agora: () => agora, agendar, esperar: semEspera });

async function criar(opcoes: { usuarioId?: string; clienteId?: number; legenda?: string; arquivos?: Uint8Array[]; modo?: "agora" | "fila"; dependencias?: ReturnType<typeof deps> } = {}) {
  const arquivos = opcoes.arquivos ?? [await gerarImagem(1080, 1350)];
  return criarPostPronto(
    { usuarioId: opcoes.usuarioId ?? "pp-dono-a", clienteId: opcoes.clienteId ?? marcaA, legenda: opcoes.legenda ?? "Minha legenda #oferta", arquivos, modo: opcoes.modo ?? "fila" },
    opcoes.dependencias ?? deps(),
  );
}

async function criarOk(opcoes: Parameters<typeof criar>[0] = {}): Promise<number> {
  const r = await criar(opcoes);
  if (!r.ok) throw new Error(`nao criou: ${r.frase}`);
  return r.postId;
}

async function linha(id: number) {
  const [l] = await db().select().from(postsProntos).where(eq(postsProntos.id, id));
  return l;
}

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "teste-post-pronto-"));
  pastaDeImagens = mkdtempSync(join(tmpdir(), "teste-post-pronto-img-"));
  process.env.PUBLICAR_PASTA_TEMP = pasta;
  process.env.PUBLICAR_IMAGENS_ATIVO = "1";
  process.env.PUBLICAR_INTERVALO_MIN = "10";
  await resetarSchema(db());
  config.metaConexao.tokenChave = Buffer.alloc(32, 17).toString("base64");
  config.metaConexao.instagram.appId = "990602627938098";
  config.metaConexao.instagram.appSecret = "segredo-do-app-do-instagram-da-suite";

  const [nicho] = await db().insert(nichos).values({ slug: "post-pronto-teste", nome: "Post pronto teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "pp-dono-a", name: "Dono A", email: "pp-dono-a@exemplo.teste", role: "cliente" },
    { id: "pp-membro-a", name: "Membro A", email: "pp-membro-a@exemplo.teste", role: "cliente" },
    { id: "pp-dono-b", name: "Dono B", email: "pp-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "pp-dono-a", nome: "[teste] Marca A", nichoId: nicho.id, perfis },
      { usuarioId: "pp-dono-b", nome: "[teste] Marca B", nichoId: nicho.id, perfis },
    ])
    .returning();
  [marcaA, marcaB] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "pp-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "pp-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "pp-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
}, 60_000);

beforeEach(async () => {
  await db().delete(postsProntos);
  await db().delete(contasConectadas);
  rmSync(join(pasta, "posts"), { recursive: true, force: true });
  await ligarContaDoInstagram({ clienteId: marcaA, igId: IG_A, token: TOKEN_A, nome: "marca.a" });
  await ligarContaDoInstagram({ clienteId: marcaB, igId: IG_B, token: TOKEN_B, nome: "marca.b" });
  mockFetch.mockReset();
  chamadas.length = 0;
  baixadas.length = 0;
  estado.logs.length = 0;
  estado.sessao = null;
  estado.verComo = false;
  estado.barrada = false;
  process.env.PUBLICAR_IMAGENS_ATIVO = "1";
  process.env.PUBLICAR_INTERVALO_MIN = "10";
  config.metaConexao.ativa = true;
  config.metaConexao.instagram.ativa = true;
  config.metaConexao.viaFacebookLigada = false;
  config.appUrl = "https://klaki.exemplo.teste";
  inicio = new Date();
  instalarInstagram();
});

afterEach(async () => {
  // Em nenhum teste um acesso pode ter ido parar em log nem na tabela de posts.
  const tudo = JSON.stringify([estado.logs, await db().select().from(postsProntos)]);
  for (const token of TOKENS) expect(tudo, `o acesso ${token} apareceu em log ou na tabela de posts`).not.toContain(token);
});

afterAll(async () => {
  rmSync(pasta, { recursive: true, force: true });
  rmSync(pastaDeImagens, { recursive: true, force: true });
  delete process.env.PUBLICAR_PASTA_TEMP;
  delete process.env.PUBLICAR_IMAGENS_ATIVO;
  delete process.env.PUBLICAR_INTERVALO_MIN;
  await getPool().end();
});

// ---------------------------------------------------------------------------
// Imagem única
// ---------------------------------------------------------------------------

describe("post de uma imagem", () => {
  it("converte o PNG para JPEG, publica com a legenda, guarda o link e apaga as imagens", async () => {
    const png = await gerarImagem(1080, 1350, "png");
    const id = await criarOk({ arquivos: [png], legenda: "  Legenda do post #oferta  " });
    // Guardado como JPEG, nunca como o PNG que a pessoa mandou.
    const guardado = readFileSync(caminhoDaImagem(id, 0));
    expect(ehJpeg(guardado)).toBe(true);
    expect(ehJpeg(png)).toBe(false);
    expect(guardado.byteLength).toBeLessThanOrEqual(8_000_000);
    expect(await linha(id)).toMatchObject({ estado: "na_fila", legenda: "Legenda do post #oferta" });
    expect((await linha(id)).imagens[0]).toMatchObject({ largura: 1080, altura: 1350 });

    expect(await publicarPost(id, deps())).toBe("publicado");
    const depois = await linha(id);
    expect(depois).toMatchObject({ estado: "publicado", midiaId: "midia-post-1", permalink: "https://www.instagram.com/p/POST1/", motivo: null });
    expect(depois.terminadoEm).not.toBeNull();

    // Um contêiner só, com o endereço público da imagem e a legenda, sem ser item de carrossel; pelo acesso da marca A e pelo graph.instagram.com.
    const containers = dasChamadas("container");
    expect(containers).toHaveLength(1);
    expect(containers[0].corpo).toMatchObject({ caption: "Legenda do post #oferta" });
    expect(containers[0].corpo.is_carousel_item).toBeUndefined();
    expect(containers[0].corpo.media_type).toBeUndefined();
    expect(containers[0].host).toBe("graph.instagram.com");
    expect(containers[0].token).toBe(TOKEN_A);
    expect(containers[0].corpo.image_url).toMatch(/^https:\/\/klaki\.exemplo\.teste\/api\/publicar-arquivo\/imagem\/\d+\.0\.\d+\.[\w-]+\/01\.jpg$/);
    // A Meta conseguiu baixar a imagem, e era um JPEG.
    expect(baixadas).toEqual([{ url: containers[0].corpo.image_url, status: 200, inicio: [0xff, 0xd8, 0xff], tipo: "image/jpeg" }]);
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect(dasChamadas("publicar")[0].corpo.creation_id).toBe("container-img-1");
    // O arquivo some quando termina.
    expect(existsSync(pastaDoPost(id))).toBe(false);
  });

  it("um JPEG que já cabe segue como está (sem perder qualidade)", async () => {
    const jpg = await gerarImagem(1080, 1080, "jpg");
    const id = await criarOk({ arquivos: [jpg] });
    expect(Buffer.compare(readFileSync(caminhoDaImagem(id, 0)), Buffer.from(jpg))).toBe(0);
  });

  it("PNG com transparência vira JPEG com fundo branco", async () => {
    const arquivo = join(pastaDeImagens, "transparente.png");
    await executar("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red@0.0:s=1080x1350,format=rgba", "-frames:v", "1", arquivo]);
    const id = await criarOk({ arquivos: [new Uint8Array(readFileSync(arquivo))] });
    const jpg = readFileSync(caminhoDaImagem(id, 0));
    expect(ehJpeg(jpg)).toBe(true);
    const { stdout } = await executar("ffmpeg", ["-nostdin", "-v", "error", "-i", caminhoDaImagem(id, 0), "-vf", "scale=1:1,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1024 });
    expect((stdout as unknown as Buffer)[0]).toBeGreaterThan(240);
  });
});

// ---------------------------------------------------------------------------
// Carrossel
// ---------------------------------------------------------------------------

describe("carrossel", () => {
  it("de 10 imagens: um contêiner por imagem na ordem, depois o do carrossel com a legenda, e uma publicação só", async () => {
    const cores = ["red", "green", "blue", "yellow", "black", "white", "orange", "purple", "pink", "gray"];
    const arquivos = await Promise.all(cores.map((c) => gerarImagem(1080, 1350, "png", c)));
    const id = await criarOk({ arquivos, legenda: "Carrossel com 10" });
    expect((await linha(id)).imagens).toHaveLength(10);

    expect(await publicarPost(id, deps())).toBe("publicado");
    const containers = dasChamadas("container");
    expect(containers).toHaveLength(11);
    // Os 10 primeiros: item de carrossel, sem legenda, cada um com o endereço da SUA imagem, na ordem.
    containers.slice(0, 10).forEach((c, i) => {
      expect(c.corpo.is_carousel_item).toBe("true");
      expect(c.corpo.caption).toBeUndefined();
      expect(c.corpo.image_url).toContain(`/${String(i + 1).padStart(2, "0")}.jpg`);
    });
    expect(baixadas.map((b) => b.status)).toEqual(Array(10).fill(200));
    // O último: o carrossel, com os filhos na ordem e a legenda.
    expect(containers[10].corpo).toMatchObject({ media_type: "CAROUSEL", caption: "Carrossel com 10", children: Array.from({ length: 10 }, (_, i) => `container-img-${i + 1}`).join(",") });
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect(dasChamadas("publicar")[0].corpo.creation_id).toBe("container-img-11");
    expect(await linha(id)).toMatchObject({ estado: "publicado" });
    expect(existsSync(pastaDoPost(id))).toBe(false);
  });

  it("recusa 11 imagens, nenhuma, e junta tudo antes de gravar: nada fica no banco nem em disco", async () => {
    const uma = await gerarImagem(1080, 1350);
    const onze = await criar({ arquivos: Array(11).fill(uma) });
    expect(onze).toEqual({ ok: false, codigo: "imagens-demais", frase: fraseDeRecusaDoPost("imagens-demais") });
    expect(fraseDeRecusaDoPost("imagens-demais")).toContain("10");
    expect(await criar({ arquivos: [] })).toMatchObject({ ok: false, codigo: "sem-imagem" });
    expect(await db().select().from(postsProntos)).toHaveLength(0);
    expect(existsSync(join(pasta, "posts"))).toBe(false);
  });

  it("uma imagem ruim no meio recusa o post inteiro, sem deixar nada para trás", async () => {
    const boa = await gerarImagem(1080, 1350);
    const larga = await gerarImagem(2000, 500); // 4:1, mais larga que 1,91:1
    const r = await criar({ arquivos: [boa, larga, boa] });
    expect(r).toMatchObject({ ok: false, codigo: "imagem-proporcao" });
    expect(await db().select().from(postsProntos)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// As conferências antes de aceitar
// ---------------------------------------------------------------------------

describe("o que a Meta aceita, conferido antes", () => {
  it("proporção: 4:5 e 1,91:1 passam; mais em pé que 4:5 e mais deitada que 1,91:1 não", async () => {
    expect((await criar({ arquivos: [await gerarImagem(1080, 1350)] })).ok).toBe(true);
    expect((await criar({ arquivos: [await gerarImagem(1910, 1000)] })).ok).toBe(true);
    expect(await criar({ arquivos: [await gerarImagem(1000, 1500)] })).toMatchObject({ ok: false, codigo: "imagem-proporcao" });
    expect(await criar({ arquivos: [await gerarImagem(2000, 1000)] })).toMatchObject({ ok: false, codigo: "imagem-proporcao" });
  });

  it("tipo pelos bytes (texto com nome .png não vale), vazio e ilegível", async () => {
    expect(await criar({ arquivos: [new TextEncoder().encode("isto nao e uma imagem")] })).toMatchObject({ ok: false, codigo: "imagem-tipo" });
    expect(await criar({ arquivos: [new Uint8Array()] })).toMatchObject({ ok: false, codigo: "imagem-vazia" });
    const quebrada = (await gerarImagem(1080, 1350, "png")).slice(0, 40);
    expect(await criar({ arquivos: [quebrada] })).toMatchObject({ ok: false, codigo: "imagem-ilegivel" });
  });

  it("legenda: acima de 2.200 letras, de 30 hashtags e de 20 marcações é recusada", async () => {
    expect(await criar({ legenda: "a".repeat(2201) })).toMatchObject({ ok: false, codigo: "legenda-longa" });
    expect(await criar({ legenda: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") })).toMatchObject({ ok: false, codigo: "legenda-hashtags" });
    expect(await criar({ legenda: Array.from({ length: 21 }, (_, i) => `@u${i}`).join(" ") })).toMatchObject({ ok: false, codigo: "legenda-marcacoes" });
  });

  it("com a chave fechada nada é aceito, e a fila não faz nada", async () => {
    process.env.PUBLICAR_IMAGENS_ATIVO = "";
    expect(await criar()).toMatchObject({ ok: false, codigo: "fechada" });
    process.env.PUBLICAR_IMAGENS_ATIVO = "1";
    const id = await criarOk();
    process.env.PUBLICAR_IMAGENS_ATIVO = "";
    expect(await rodarFilaDePosts(deps())).toMatchObject({ marcas: 0, publicados: 0 });
    expect(chamadas).toHaveLength(0);
    expect((await linha(id)).estado).toBe("na_fila");
  });
});

// ---------------------------------------------------------------------------
// O limite das 24 horas
// ---------------------------------------------------------------------------

describe("o limite de publicações por 24 horas", () => {
  it("esgotado: o post continua na fila com o aviso, nada é criado na Meta, e a fila retoma quando o limite volta", async () => {
    instalarInstagram({ limite: { usadas: 50, total: 50 } });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("limite");
    const parado = await linha(id);
    expect(parado.estado).toBe("na_fila");
    expect(parado.aviso).toContain("24 horas");
    expect(dasChamadas("container")).toHaveLength(0);
    expect((await listarPostsDaMarca(marcaA))[0].aviso).toContain("24 horas");

    // A fila não pergunta de novo antes da espera.
    chamadas.length = 0;
    expect(await rodarFilaDePosts(deps(minutos(inicio, 5)))).toMatchObject({ esperandoLimite: 1, publicados: 0 });
    expect(chamadas).toHaveLength(0);

    // Passada a espera, com o limite livre, sai sozinho.
    instalarInstagram({ limite: { usadas: 10, total: 50 } });
    const depoisDaEspera = new Date(inicio.getTime() + ESPERA_APOS_O_LIMITE_MS + 60_000);
    expect(await rodarFilaDePosts(deps(depoisDaEspera))).toMatchObject({ publicados: 1 });
    expect((await linha(id)).estado).toBe("publicado");
    expect((await linha(id)).aviso).toBeNull();
  });

  it("sem o total na resposta vale o padrão de 50", async () => {
    instalarInstagram({ limite: { usadas: 50, total: null } });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("limite");
  });

  it("a Meta recusando por limite na hora de criar volta o post para a fila (não falha)", async () => {
    instalarInstagram({ erroNoContainer: { code: 9, subcode: 2207042 } });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("limite");
    expect(await linha(id)).toMatchObject({ estado: "na_fila", containerId: null });
  });
});

// ---------------------------------------------------------------------------
// Quem pode, marca e "ver como"
// ---------------------------------------------------------------------------

describe("quem pode e o isolamento entre marcas", () => {
  it("só o dono monta, cancela e repete; membro e marca alheia são recusados", async () => {
    const arquivos = [await gerarImagem(1080, 1350)];
    expect(await criar({ usuarioId: "pp-membro-a", arquivos })).toMatchObject({ ok: false, codigo: "so-dono" });
    // O dono da B não monta na marca A.
    expect(await criar({ usuarioId: "pp-dono-b", clienteId: marcaA, arquivos })).toMatchObject({ ok: false, codigo: "so-dono" });
    const id = await criarOk();
    expect(await cancelarPostPronto("pp-membro-a", marcaA, id)).toMatchObject({ ok: false, codigo: "so-dono" });
    expect(await repetirPostPronto("pp-membro-a", marcaA, id)).toMatchObject({ ok: false, codigo: "so-dono" });
    expect((await linha(id)).estado).toBe("na_fila");
  });

  it("uma marca nunca vê, cancela, repete nem publica o post de outra, e cada uma usa o acesso da sua", async () => {
    const idA = await criarOk();
    const idB = await criarOk({ usuarioId: "pp-dono-b", clienteId: marcaB });
    expect((await listarPostsDaMarca(marcaA)).map((p) => p.id)).toEqual([idA]);
    expect((await listarPostsDaMarca(marcaB)).map((p) => p.id)).toEqual([idB]);
    // O dono da B (com a sua marca) não alcança o post da A.
    expect(await cancelarPostPronto("pp-dono-b", marcaB, idA)).toMatchObject({ ok: false, codigo: "nao-achou" });
    expect(await repetirPostPronto("pp-dono-b", marcaB, idA)).toMatchObject({ ok: false, codigo: "nao-achou" });
    expect((await linha(idA)).estado).toBe("na_fila");

    await publicarPost(idA, deps());
    await publicarPost(idB, deps(minutos(inicio, 30)));
    for (const c of chamadas.filter((x) => x.tipo === "container" || x.tipo === "publicar" || x.tipo === "limite")) {
      const igDaChamada = c.caminho.split("/")[0];
      expect(c.token === TOKEN_A ? IG_A : IG_B, `a chamada ${c.caminho} saiu com o acesso de outra marca`).toBe(igDaChamada);
    }
    expect(chamadas.filter((c) => c.token === TOKEN_A).length).toBeGreaterThan(0);
    expect(chamadas.filter((c) => c.token === TOKEN_B).length).toBeGreaterThan(0);
  });

  it("o endereço da imagem de uma marca não serve nada para quem não tem o código, com código adulterado, vencido ou depois do post", async () => {
    const id = await criarOk({ modo: "agora" });
    await db().update(postsProntos).set({ estado: "publicando" }).where(eq(postsProntos.id, id));
    const { criarCodigoDaImagem } = await import("@/lib/imagens-do-post");
    const pedir = (codigo: string, metodo: "GET" | "HEAD" = "GET") => (metodo === "GET" ? baixarImagem : cabecalhosDaImagem)(new Request(`https://x.teste/api/publicar-arquivo/imagem/${codigo}/01.jpg`, { method: metodo }), { params: Promise.resolve({ codigo, nome: "01.jpg" }) });
    const bom = criarCodigoDaImagem(id, 0);
    expect((await pedir(bom)).status).toBe(200);
    const cabecalhos = await pedir(bom, "HEAD");
    expect(cabecalhos.status).toBe(200);
    expect(cabecalhos.headers.get("content-type")).toBe("image/jpeg");
    expect((await pedir(bom.slice(0, -2) + "xx")).status).toBe(404);
    expect((await pedir(`${id + 1}.0.${bom.split(".")[2]}.${bom.split(".")[3]}`)).status).toBe(404);
    expect((await pedir(criarCodigoDaImagem(id, 0, new Date(Date.now() - 4 * 3600 * 1000)))).status).toBe(404);
    expect((await pedir(criarCodigoDaImagem(id, 5))).status).toBe(404);
    // Fora de `publicando` o endereço deixa de valer.
    await db().update(postsProntos).set({ estado: "na_fila" }).where(eq(postsProntos.id, id));
    expect((await pedir(bom)).status).toBe(404);
  });

  it("o 'ver como' nunca monta, cancela nem repete (rota e ações)", async () => {
    const id = await criarOk();
    estado.verComo = true;
    entrar("pp-dono-a");
    const form = new FormData();
    form.append("imagens", new File([new Uint8Array(await gerarImagem(1080, 1350))], "a.png", { type: "image/png" }));
    form.append("modo", "fila");
    const rota = await montarRota(new Request("https://x.teste/api/posts-prontos", { method: "POST", body: form }));
    expect(rota.status).toBe(403);
    expect(await cancelarPostAction(id)).toMatchObject({ ok: false });
    expect(await repetirPostAction(id)).toMatchObject({ ok: false });
    expect((await linha(id)).estado).toBe("na_fila");
    expect(await db().select().from(postsProntos)).toHaveLength(1);
  });

  it("a rota monta com a sessão do dono; recusa quem não entrou e a assinatura vencida", async () => {
    const montar = async () => {
      const form = new FormData();
      form.append("imagens", new File([new Uint8Array(await gerarImagem(1080, 1350))], "a.png", { type: "image/png" }));
      form.append("imagens", new File([new Uint8Array(await gerarImagem(1080, 1350, "png", "red"))], "b.png", { type: "image/png" }));
      form.append("legenda", "Pela rota #teste");
      form.append("modo", "fila");
      return montarRota(new Request("https://x.teste/api/posts-prontos", { method: "POST", body: form }));
    };
    expect((await montar()).status).toBe(401);
    entrar("pp-dono-a");
    estado.barrada = true;
    expect((await montar()).status).toBe(402);
    estado.barrada = false;
    const ok = await montar();
    expect(ok.status).toBe(200);
    const { postId } = (await ok.json()) as { postId: number };
    expect(await linha(postId)).toMatchObject({ clienteId: marcaA, estado: "na_fila", legenda: "Pela rota #teste", criadoPor: "pp-dono-a" });
    expect((await linha(postId)).imagens).toHaveLength(2);
    // Membro que não é dono: a rota devolve a frase.
    entrar("pp-membro-a");
    const membro = await montar();
    expect(membro.status).toBe(403);
    // A marca sem Instagram ligado.
    await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marcaA));
    entrar("pp-dono-a");
    const semConta = await montar();
    expect(semConta.status).toBe(400);
    expect(((await semConta.json()) as { codigo: string }).codigo).toBe("sem-conta");
  });
});

// ---------------------------------------------------------------------------
// Publicar uma vez só
// ---------------------------------------------------------------------------

describe("publicar uma vez só", () => {
  it("duas chamadas ao mesmo tempo para o mesmo post: a Meta recebe UM pedido de publicar", async () => {
    instalarInstagram({ demoraNoPublicar: 80 });
    const id = await criarOk();
    const [a, b] = await Promise.all([publicarPost(id, deps()), publicarPost(id, deps())]);
    expect([a, b].filter((r) => r === "publicado")).toHaveLength(1);
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect((await linha(id)).estado).toBe("publicado");
  });

  it("dois posts da mesma marca ao mesmo tempo: só um é publicado agora, o outro espera a vez", async () => {
    instalarInstagram({ demoraNoPublicar: 120 });
    const um = await criarOk();
    const dois = await criarOk();
    const resultados = await Promise.all([publicarPost(um, deps()), publicarPost(dois, deps())]);
    expect(resultados.filter((r) => r === "publicado")).toHaveLength(1);
    expect(resultados.filter((r) => r === "ocupada")).toHaveLength(1);
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect((await db().select().from(postsProntos).where(eq(postsProntos.estado, "na_fila"))).length).toBe(1);
  });

  it("depois de publicado, chamar de novo não publica outra vez", async () => {
    const id = await criarOk();
    await publicarPost(id, deps());
    expect(await publicarPost(id, deps())).toBe("ignorado");
    expect(dasChamadas("publicar")).toHaveLength(1);
  });

  it("resposta perdida ao publicar: 'não confirmou', nunca tenta de novo, não volta para a fila e as imagens somem", async () => {
    instalarInstagram({ erroAoPublicar: "rede" });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("falhou");
    const l = await linha(id);
    expect(l).toMatchObject({ estado: "falhou", codigoFalha: "nao-confirmou", motivo: fraseDeFalhaDoPost("nao-confirmou") });
    expect(l.motivo).toContain("confira");
    expect(existsSync(pastaDoPost(id))).toBe(false);
    expect(await repetirPostPronto("pp-dono-a", marcaA, id)).toMatchObject({ ok: false, codigo: "nao-da-para-repetir" });
    expect((await listarPostsDaMarca(marcaA))[0].podeRepetir).toBe(false);
    // A fila nunca o publica de novo.
    instalarInstagram();
    chamadas.length = 0;
    await rodarFilaDePosts(deps(minutos(inicio, 60)));
    expect(dasChamadas("publicar")).toHaveLength(0);
  });

  it("502 ao publicar com o contêiner PUBLISHED: termina publicado, uma só publicação", async () => {
    instalarInstagram({ erroAoPublicar: { http: 502 }, status: ["FINISHED", "PUBLISHED"] });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("publicado");
    expect(await linha(id)).toMatchObject({ estado: "publicado", codigoFalha: null });
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect(existsSync(pastaDoPost(id))).toBe(false);
  });

  it("502 e 504 ao publicar sem o contêiner publicado: 'não confirmou', sem 'Pôr na fila de novo', e nunca publica de novo", async () => {
    for (const http of [502, 504]) {
      instalarInstagram({ erroAoPublicar: { http } });
      chamadas.length = 0;
      const id = await criarOk();
      expect(await publicarPost(id, deps())).toBe("falhou");
      expect(await linha(id)).toMatchObject({ estado: "falhou", codigoFalha: "nao-confirmou" });
      expect((await listarPostsDaMarca(marcaA)).find((p) => p.id === id)?.podeRepetir).toBe(false);
      expect(await repetirPostPronto("pp-dono-a", marcaA, id)).toMatchObject({ ok: false, codigo: "nao-da-para-repetir" });
      expect(dasChamadas("publicar")).toHaveLength(1);
    }
  });

  it("códigos 1 e 2 da Meta ao publicar: 'não confirmou' (a Meta pode ter publicado)", async () => {
    for (const code of [1, 2]) {
      instalarInstagram({ erroAoPublicar: { code } });
      const id = await criarOk();
      expect(await publicarPost(id, deps())).toBe("falhou");
      expect((await linha(id)).codigoFalha).toBe("nao-confirmou");
      expect((await listarPostsDaMarca(marcaA)).find((p) => p.id === id)?.podeRepetir).toBe(false);
    }
  });

  it("um código que prova a recusa (formato, 100) continua repetível ao publicar", async () => {
    instalarInstagram({ erroAoPublicar: { code: 100, subcode: 2207026 } });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("falhou");
    expect((await linha(id)).codigoFalha).toBe("formato");
    expect((await listarPostsDaMarca(marcaA)).find((p) => p.id === id)?.podeRepetir).toBe(true);
  });

  it("com a chave desligada publicarPost não publica nem chama a Meta, e a rota da imagem responde 404", async () => {
    const id = await criarOk();
    process.env.PUBLICAR_IMAGENS_ATIVO = "";
    chamadas.length = 0;
    expect(await publicarPost(id, deps())).toBe("ignorado");
    expect(chamadas).toHaveLength(0);
    expect((await linha(id)).estado).toBe("na_fila");
    // a rota: com a chave ligada serve a imagem do post que está publicando; desligada, 404 com o mesmo código
    process.env.PUBLICAR_IMAGENS_ATIVO = "1";
    const outro = await criarOk();
    await db().update(postsProntos).set({ estado: "publicando" }).where(eq(postsProntos.id, outro));
    const url = enderecoPublicoDaImagem(outro, 0, new Date());
    const partes = new URL(url).pathname.split("/");
    const pedir = () => baixarImagem(new Request(url), { params: Promise.resolve({ codigo: decodeURIComponent(partes[4] ?? ""), nome: partes[5] ?? "01.jpg" }) });
    expect((await pedir()).status).toBe(200);
    process.env.PUBLICAR_IMAGENS_ATIVO = "";
    expect((await pedir()).status).toBe(404);
  });

  it("a espera do contêiner atualiza 'atualizadoEm' a cada rodada (o recolhedor não toma por parado um post vivo)", async () => {
    const id = await criarOk();
    const tempos: number[] = [];
    instalarInstagram({ status: ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const esperar = async () => {
      tempos.push((await linha(id)).atualizadoEm.getTime());
      await new Promise((r) => setTimeout(r, 15));
    };
    expect(await publicarPost(id, { agora: () => new Date(), agendar: vi.fn(async () => undefined), esperar })).toBe("publicado");
    expect(tempos).toHaveLength(3);
    expect(tempos[1]).toBeGreaterThan(tempos[0]);
    expect(tempos[2]).toBeGreaterThan(tempos[1]);
  });

  it("o worker que caiu no meio (publicando há demais) vira 'não confirmou' e não publica de novo", async () => {
    const id = await criarOk();
    await db().update(postsProntos).set({ estado: "publicando", atualizadoEm: inicio }).where(eq(postsProntos.id, id));
    const resumo = await rodarFilaDePosts(deps(minutos(inicio, 10)));
    expect(resumo.recolhidos).toBe(1);
    expect(await linha(id)).toMatchObject({ estado: "falhou", codigoFalha: "nao-confirmou" });
    expect(dasChamadas("publicar")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Falhas, cancelar e repetir
// ---------------------------------------------------------------------------

describe("falhas, cancelar e repetir", () => {
  it("a Meta recusando o formato: falha com a frase de gente, sem código da Meta na frase, e dá para pôr na fila de novo", async () => {
    instalarInstagram({ erroNoContainer: { code: 100, subcode: 2207026 } });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("falhou");
    const l = await linha(id);
    expect(l).toMatchObject({ estado: "falhou", codigoFalha: "formato", codigoMeta: 100, subcodigoMeta: 2207026 });
    expect(l.motivo).toBe(fraseDeFalhaDoPost("formato"));
    expect(l.motivo).not.toMatch(/2207026|\b100\b/);
    expect(existsSync(caminhoDaImagem(id, 0))).toBe(true);

    const volta = await repetirPostPronto("pp-dono-a", marcaA, id);
    expect(volta).toMatchObject({ ok: true, vista: { estado: "na_fila", motivo: null } });
    expect(await linha(id)).toMatchObject({ estado: "na_fila", containerId: null, codigoFalha: null });
  });

  it("o preparo da Meta que não termina falha com 'demorou'; ERROR falha com 'não preparou'", async () => {
    instalarInstagram({ status: ["IN_PROGRESS"] });
    const a = await criarOk();
    expect(await publicarPost(a, deps())).toBe("falhou");
    expect((await linha(a)).codigoFalha).toBe("demorou");
    instalarInstagram({ status: ["IN_PROGRESS", "ERROR"] });
    const b = await criarOk({ dependencias: deps(minutos(inicio, 1)) });
    expect(await publicarPost(b, deps(minutos(inicio, 1)))).toBe("falhou");
    expect((await linha(b)).codigoFalha).toBe("nao-preparou");
  });

  it("espera o preparo (IN_PROGRESS) e publica quando a Meta diz FINISHED", async () => {
    instalarInstagram({ status: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("publicado");
    expect(dasChamadas("status")).toHaveLength(3);
    expect(dasChamadas("publicar")).toHaveLength(1);
  });

  it("acesso recusado pela Meta (190): falha, marca o erro na conta e pede para ligar de novo", async () => {
    instalarInstagram({ erroNoContainer: { code: 190 } });
    const id = await criarOk();
    expect(await publicarPost(id, deps())).toBe("falhou");
    expect((await linha(id)).codigoFalha).toBe("acesso-perdido");
    const [conta] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marcaA));
    expect(conta.erro).not.toBeNull();
  });

  it("imagem que sumiu do disco: falha 'imagem-sumiu' e não dá para repetir", async () => {
    const id = await criarOk();
    rmSync(pastaDoPost(id), { recursive: true, force: true });
    expect(await publicarPost(id, deps())).toBe("falhou");
    expect((await linha(id)).codigoFalha).toBe("imagem-sumiu");
    expect(dasChamadas("container")).toHaveLength(0);
    expect(await repetirPostPronto("pp-dono-a", marcaA, id)).toMatchObject({ ok: false });
  });

  it("cancelar: na fila vira cancelado e apaga as imagens; publicando não cancela", async () => {
    const id = await criarOk();
    expect(existsSync(pastaDoPost(id))).toBe(true);
    const r = await cancelarPostPronto("pp-dono-a", marcaA, id);
    expect(r).toMatchObject({ ok: true, vista: { estado: "cancelado" } });
    expect(existsSync(pastaDoPost(id))).toBe(false);
    expect(await publicarPost(id, deps())).toBe("ignorado");

    const outro = await criarOk();
    await db().update(postsProntos).set({ estado: "publicando" }).where(eq(postsProntos.id, outro));
    expect(await cancelarPostPronto("pp-dono-a", marcaA, outro)).toMatchObject({ ok: false, codigo: "nao-da-para-cancelar" });
    expect((await linha(outro)).estado).toBe("publicando");
  });

  it("as ações da tela cancelam e repetem pela marca da sessão", async () => {
    const id = await criarOk();
    entrar("pp-dono-b");
    expect(await cancelarPostAction(id)).toMatchObject({ ok: false });
    expect((await linha(id)).estado).toBe("na_fila");
    entrar("pp-dono-a");
    expect(await cancelarPostAction(id)).toMatchObject({ ok: true });
    estado.barrada = true;
    await expect(repetirPostAction(id)).rejects.toThrow(/REDIRECT/);
  });

  it("a varredura apaga pasta de quem terminou, de quem não existe mais e de falha velha, e preserva a de quem espera", async () => {
    const espera = await criarOk();
    const publicado = await criarOk();
    const falhaNova = await criarOk();
    const falhaVelha = await criarOk();
    const orfa = 99999;
    mkdirSync(pastaDoPost(orfa), { recursive: true });
    writeFileSync(join(pastaDoPost(orfa), "01.jpg"), "x");
    await db().update(postsProntos).set({ estado: "publicado", terminadoEm: inicio }).where(eq(postsProntos.id, publicado));
    await db().update(postsProntos).set({ estado: "falhou", terminadoEm: inicio }).where(eq(postsProntos.id, falhaNova));
    await db().update(postsProntos).set({ estado: "falhou", terminadoEm: new Date(inicio.getTime() - 4 * 24 * 3600 * 1000) }).where(eq(postsProntos.id, falhaVelha));
    expect(await varrerImagensDosPosts(inicio)).toBe(3);
    expect(existsSync(pastaDoPost(espera))).toBe(true);
    expect(existsSync(pastaDoPost(falhaNova))).toBe(true);
    expect(existsSync(pastaDoPost(publicado))).toBe(false);
    expect(existsSync(pastaDoPost(falhaVelha))).toBe(false);
    expect(existsSync(pastaDoPost(orfa))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A fila
// ---------------------------------------------------------------------------

describe("a fila com intervalo", () => {
  it("publica um por vez, na ordem, só depois do intervalo; 'Publicar agora' fura a espera do intervalo mas não a de outro em curso", async () => {
    const [um, dois, tres] = [await criarOk({ legenda: "um" }), await criarOk({ legenda: "dois" }), await criarOk({ legenda: "tres" })];

    expect(await rodarFilaDePosts(deps(inicio))).toMatchObject({ marcas: 1, publicados: 1 });
    expect((await linha(um)).estado).toBe("publicado");
    expect((await linha(dois)).estado).toBe("na_fila");

    // 5 minutos depois: ainda no intervalo de 10.
    chamadas.length = 0;
    expect(await rodarFilaDePosts(deps(minutos(inicio, 5)))).toMatchObject({ publicados: 0 });
    expect(chamadas).toHaveLength(0);

    // 10 minutos: sai o segundo, e só ele.
    expect(await rodarFilaDePosts(deps(minutos(inicio, 10)))).toMatchObject({ publicados: 1 });
    expect((await linha(dois)).estado).toBe("publicado");
    expect((await linha(tres)).estado).toBe("na_fila");
    expect(dasChamadas("container").map((c) => c.corpo.caption)).toEqual(["dois"]);

    // Um post "agora" criado depois passa na frente do terceiro e não espera o intervalo.
    const urgente = await criarOk({ legenda: "agora", modo: "agora" });
    expect(await rodarFilaDePosts(deps(minutos(inicio, 11)))).toMatchObject({ publicados: 1 });
    expect((await linha(urgente)).estado).toBe("publicado");
    expect((await linha(tres)).estado).toBe("na_fila");
  });

  it("o intervalo vem de PUBLICAR_INTERVALO_MIN (padrão 10)", async () => {
    process.env.PUBLICAR_INTERVALO_MIN = "30";
    const [um, dois] = [await criarOk(), await criarOk()];
    await rodarFilaDePosts(deps(inicio));
    await rodarFilaDePosts(deps(minutos(inicio, 29)));
    expect((await linha(dois)).estado).toBe("na_fila");
    await rodarFilaDePosts(deps(minutos(inicio, 30)));
    expect((await linha(um)).estado).toBe("publicado");
    expect((await linha(dois)).estado).toBe("publicado");
    delete process.env.PUBLICAR_INTERVALO_MIN;
    const { intervaloEntrePostsMin } = await import("@/config/post-pronto");
    expect(intervaloEntrePostsMin()).toBe(10);
  });

  it("cada marca tem a sua fila: as duas andam na mesma rodada, cada uma com o próprio acesso", async () => {
    const a = await criarOk();
    const b = await criarOk({ usuarioId: "pp-dono-b", clienteId: marcaB });
    expect(await rodarFilaDePosts(deps(inicio))).toMatchObject({ marcas: 2, publicados: 2 });
    expect((await linha(a)).estado).toBe("publicado");
    expect((await linha(b)).estado).toBe("publicado");
  });

  it("uma falha não trava a fila: o próximo sai depois do intervalo", async () => {
    instalarInstagram({ erroNoContainer: { code: 100, subcode: 2207026 } });
    const [um, dois] = [await criarOk(), await criarOk()];
    expect(await rodarFilaDePosts(deps(inicio))).toMatchObject({ falhas: 1 });
    expect((await linha(um)).estado).toBe("falhou");
    instalarInstagram();
    await rodarFilaDePosts(deps(minutos(inicio, 10)));
    expect((await linha(dois)).estado).toBe("publicado");
  });

  it("'Publicar agora' avisa o worker (o evento) e o post sai pelo mesmo caminho", async () => {
    const agendar = vi.fn(async () => undefined);
    const id = await criarOk({ modo: "agora", dependencias: deps(inicio, agendar) });
    expect(agendar).toHaveBeenCalledWith(id);
    expect((await linha(id)).agora).toBe(true);
    expect(await publicarPost(id, deps())).toBe("publicado");
  });
});

// ---------------------------------------------------------------------------
// O envio em lote do admin
// ---------------------------------------------------------------------------

describe("envio em lote (admin)", () => {
  it("lê as legendas por nome da pasta ou pelo número, sem confundir hashtag com título", () => {
    const mapa = lerLegendas("# Título solto\n\n## 01-lavanderia\nPrimeira linha\n#hashtag #outra\n\n## 2\nSegunda\r\n\n## 03-sem-texto\n");
    expect([...mapa.keys()]).toEqual(["01-lavanderia", "2", "03-sem-texto"]);
    expect(mapa.get("01-lavanderia")).toBe("Primeira linha\n#hashtag #outra");
    expect(mapa.get("2")).toBe("Segunda");
    expect(mapa.get("03-sem-texto")).toBe("");
  });

  it("cria os posts na fila da marca, na ordem do número, e reporta o que não deu", async () => {
    const lote = mkdtempSync(join(tmpdir(), "teste-lote-"));
    try {
      const gravar = async (subpasta: string, nomes: string[], proporcao: [number, number] = [1080, 1350]) => {
        mkdirSync(join(lote, subpasta), { recursive: true });
        for (const nome of nomes) writeFileSync(join(lote, subpasta, nome), await gerarImagem(proporcao[0], proporcao[1], nome.endsWith(".jpg") ? "jpg" : "png", "green"));
      };
      await gravar("10-ultimo", ["01.png"]);
      await gravar("02-carrossel", ["02.png", "01.png", "10.png"]);
      await gravar("01-primeiro", ["capa.jpg"]);
      await gravar("03-sem-legenda", ["01.png"]);
      await gravar("04-larga", ["01.png"], [2000, 500]);
      mkdirSync(join(lote, "sem-numero"));
      writeFileSync(join(lote, "legendas.md"), "## 01-primeiro\nLegenda um #a\n\n## 02\nLegenda dois\n\n## 10-ultimo\nLegenda dez\n\n## 04-larga\nlarga\n");
      const r = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote, usuarioId: null });
      expect(r.criados.map((c) => c.pasta)).toEqual(["01-primeiro", "02-carrossel", "10-ultimo"]);
      expect(r.problemas.map((p) => p.pasta)).toEqual(["03-sem-legenda", "04-larga"]);
      expect(r.problemas[1].frase).toBe(fraseDeRecusaDoPost("imagem-proporcao"));
      const fila = await listarPostsDaMarca(marcaA);
      expect(fila.map((p) => [p.legenda, p.imagens])).toEqual([["Legenda um #a", 1], ["Legenda dois", 3], ["Legenda dez", 1]]);
      expect(fila.every((p) => p.estado === "na_fila")).toBe(true);
      expect((await db().select().from(postsProntos)).every((p) => p.clienteId === marcaA)).toBe(true);
    } finally {
      rmSync(lote, { recursive: true, force: true });
    }
  }, 60_000);

  it("segunda rodada: não cria de novo o que já está na fila e recusa a marca com post na fila (salvo --mesmo-assim)", async () => {
    const lote = mkdtempSync(join(tmpdir(), "teste-lote-2-"));
    try {
      for (const [sub, cor] of [["01-a", "green"], ["02-b", "red"]]) {
        mkdirSync(join(lote, sub), { recursive: true });
        writeFileSync(join(lote, sub, "01.png"), await gerarImagem(1080, 1350, "png", cor));
      }
      writeFileSync(join(lote, "legendas.md"), "## 01-a\nLegenda A\n\n## 02-b\nLegenda B\n");
      const um = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote });
      expect(um.criados).toHaveLength(2);
      expect(await recusaDoLote(marcaA)).toContain("--mesmo-assim");
      const dois = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote });
      expect(dois.criados).toHaveLength(0);
      expect(dois.recusa).toContain("na fila");
      expect((await db().select().from(postsProntos)).length).toBe(2);
      // liberada, a legenda que já existe é pulada, mesmo com a fila ocupada
      const tres = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote, mesmoAssim: true });
      expect(tres.criados).toHaveLength(0);
      expect(tres.pulados.map((p) => p.pasta)).toEqual(["01-a", "02-b"]);
      expect((await db().select().from(postsProntos)).length).toBe(2);
      // legenda de post cancelado não conta
      const [primeiro] = await listarPostsDaMarca(marcaA);
      await cancelarPostPronto("pp-dono-a", marcaA, primeiro.id);
      const quatro = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote, mesmoAssim: true });
      expect(quatro.criados).toHaveLength(1);
    } finally {
      rmSync(lote, { recursive: true, force: true });
    }
  }, 60_000);

  it("a subpasta com video.mp4 é pulada (as cenas de referência não viram carrossel) e a marca sem Instagram ligado recusa tudo", async () => {
    const lote = mkdtempSync(join(tmpdir(), "teste-lote-3-"));
    try {
      mkdirSync(join(lote, "01-reels"), { recursive: true });
      writeFileSync(join(lote, "01-reels", "video.mp4"), Buffer.from("nao e video de verdade"));
      for (const n of ["cena-01.png", "cena-02.png"]) writeFileSync(join(lote, "01-reels", n), await gerarImagem(1080, 1350));
      mkdirSync(join(lote, "02-foto"), { recursive: true });
      writeFileSync(join(lote, "02-foto", "01.png"), await gerarImagem(1080, 1350, "png", "red"));
      writeFileSync(join(lote, "legendas.md"), "## 01-reels\nLegenda do reels\n\n## 02-foto\nLegenda da foto\n");
      const lista = await lerPastaDePosts(lote);
      expect(lista.map((p) => [p.pasta, p.temVideo])).toEqual([["01-reels", true], ["02-foto", false]]);
      const r = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote });
      expect(r.criados.map((c) => c.pasta)).toEqual(["02-foto"]);
      expect(r.pulados).toEqual([{ pasta: "01-reels", frase: FRASE_DE_VIDEO }]);
      expect((await db().select().from(postsProntos)).length).toBe(1);
      await db().delete(postsProntos);
      await db().delete(contasConectadas).where(eq(contasConectadas.clienteId, marcaA));
      const sem = await importarPostsDaPasta({ clienteId: marcaA, pasta: lote });
      expect(sem.criados).toHaveLength(0);
      expect(sem.recusa).toContain("Instagram");
      expect((await db().select().from(postsProntos)).length).toBe(0);
    } finally {
      rmSync(lote, { recursive: true, force: true });
    }
  }, 60_000);
});
