/**
 * E19b, publicar no Instagram pela via do Login do Instagram (`graph.instagram.com`), contra o Postgres local e SEM rede: a Graph API é simulada pelo `fetch`. Aqui não há envio retomável
 * (`pesquisa/plataformas/docs/meta/publicacao-de-conteudo.md`: "Apenas para apps que implementaram o Login do Facebook para Empresas"): o vídeo é guardado em disco por pouco tempo, a Meta o baixa
 * por um endereço público assinado (`video_url`) e o arquivo some quando a publicação termina. Prova: o fluxo de Reels e de Story, o endereço público servido (inteiro, por pedaços, só com o
 * código certo, só enquanto a publicação vive), o arquivo apagado em cada fim possível, o isolamento entre marcas (o acesso de cada uma), só o dono, o "ver como", o limite do dia e que o acesso
 * nunca vai para log nem para a tabela. A via do Facebook tem os testes dela em `publicar-instagram.test.ts`.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

import { PREPARO_DA_META_PRAZO_MS } from "@/config/publicacao";
import { db, getPool } from "@/db";
import { clientes, contasConectadas, membrosMarca, nichos, publicacoes, roteiros, user, videosCliente } from "@/db/schema";
import { config } from "@/lib/config";
import { cifrarToken, contextoDoToken } from "@/lib/meta-token";
import { caminhoDoVideo, criarCodigoDoVideo, VALIDADE_DO_ENDERECO_MS } from "@/lib/video-temporario";
import { cancelarEnvio, conferirPublicacao, iniciarPublicacao, receberVideo } from "@/servicos/publicar-instagram";
import { fraseDeRecusa } from "@/textos/publicar";

import { resetarSchema } from "../../scripts/resetar-schema";

const { PUT: enviarVideoRota } = await import("@/app/api/publicar/[id]/video/route");
const { GET: baixarArquivo, HEAD: cabecalhosDoArquivo } = await import("@/app/api/publicar-arquivo/[codigo]/[nome]/route");

const TOKEN_A = "IGQ-TOKEN-DA-MARCA-A-NUNCA-NO-BANCO";
const TOKEN_B = "IGQ-TOKEN-DA-MARCA-B-NUNCA-NO-BANCO";
const TOKENS = [TOKEN_A, TOKEN_B];
const IG_A = "17841400000000a01";
const IG_B = "17841400000000b01";
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let marcaA: number;
let marcaB: number;
let pasta: string;

// ---------------------------------------------------------------------------
// O Instagram simulado
// ---------------------------------------------------------------------------

type Cenario = {
  status?: string[];
  erroNoContainer?: { code: number; subcode?: number };
  erroAoPublicar?: { code: number; subcode?: number };
  limite?: { usadas: number; total: number | null };
};
type Chamada = { tipo: "container" | "status" | "publicar" | "permalink" | "limite" | "outra"; host: string; metodo: string; caminho: string; token: string; corpo: Record<string, string>; query: Record<string, string> };
const chamadas: Chamada[] = [];
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
    const registro = (tipo: Chamada["tipo"]) => chamadas.push({ tipo, host: url.host, metodo, caminho, token, corpo, query: Object.fromEntries(url.searchParams) });
    if (url.host !== "graph.instagram.com") {
      registro("outra");
      return json({ error: { message: "so o graph.instagram.com devia ser chamado", code: 1 } }, 400);
    }
    if (metodo === "POST" && caminho.endsWith("/media")) {
      registro("container");
      if (c.erroNoContainer) return json({ error: { message: "erro simulado", code: c.erroNoContainer.code, error_subcode: c.erroNoContainer.subcode } }, 400);
      sequencia += 1;
      return json({ id: `container-ig-${sequencia}` });
    }
    if (metodo === "POST" && caminho.endsWith("/media_publish")) {
      registro("publicar");
      if (c.erroAoPublicar) return json({ error: { message: "erro simulado", code: c.erroAoPublicar.code, error_subcode: c.erroAoPublicar.subcode } }, 400);
      return json({ id: "midia-ig-1" });
    }
    if (caminho.endsWith("/content_publishing_limit")) {
      registro("limite");
      const limite = c.limite ?? { usadas: 2, total: 100 };
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
      return json({ permalink: "https://www.instagram.com/reel/IGSIM1/", id: caminho });
    }
    registro("outra");
    return json({ error: { message: "caminho desconhecido do simulador", code: 100 } }, 404);
  });
}

const dasChamadas = (tipo: Chamada["tipo"]) => chamadas.filter((c) => c.tipo === tipo);

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

const CONTEUDO = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "Chame no WhatsApp.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

async function criarRoteiro(clienteId: number, extra: Partial<typeof roteiros.$inferInsert> = {}) {
  const [r] = await db()
    .insert(roteiros)
    .values({ clienteId, data: "2026-10-23", tema: "tema", origem: "sugerido", objetivo: "alcance", conteudo: CONTEUDO, ...extra })
    .returning();
  return r;
}

async function ligarContaDoInstagram(o: { clienteId: number; igId: string; token: string; nome: string; publicarLiberado?: boolean }) {
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
      tokenExpiraEm: new Date("2027-06-01T00:00:00Z"),
      publicarLiberado: o.publicarLiberado ?? true,
      conectadaEm: new Date("2026-10-01T00:00:00Z"),
    });
}

function entrar(usuarioId: string | null): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: "cliente", name: usuarioId }, session: { userId: usuarioId }, verComo: null } : null;
}

const agoraFixo = new Date("2026-10-27T15:00:00Z");
// O relógio da máquina é congelado em `agoraFixo` (só o `Date`; timers e rede seguem reais). Sem isso a rota do endereço público, que lê o relógio de verdade, via o código assinado com
// `agoraFixo` como vencido assim que passassem 3 horas de 27/10 15:00Z, e a varredura comparava a idade do arquivo (mtime real) com o relógio injetado: o teste só passava no dia em que foi escrito.
const deps = (agendar = vi.fn(async () => undefined)) => ({ agora: () => agoraFixo, agendar });

function entradaDeIniciar(extra: Partial<Parameters<typeof iniciarPublicacao>[0]> & { roteiroId: number }): Parameters<typeof iniciarPublicacao>[0] {
  return { usuarioId: "pv-dono-a", clienteId: marcaA, tipo: "reels", legenda: "Minha legenda #oferta", tamanhoBytes: 5, tipoDoArquivo: "video/mp4", nomeDoArquivo: "video.mp4", ...extra };
}

function fluxoDe(bytes: Uint8Array | number[]): ReadableStream<Uint8Array> {
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(dados);
      c.close();
    },
  });
}

async function linha(id: number) {
  const [l] = await db().select().from(publicacoes).where(eq(publicacoes.id, id));
  return l;
}

async function iniciarEEnviar(roteiroId: number, extra: Partial<Parameters<typeof iniciarPublicacao>[0]> = {}, bytes: number[] = [1, 2, 3, 4, 5], dependencias = deps()) {
  const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId, tamanhoBytes: bytes.length, ...extra }), dependencias);
  if (!inicio.ok) throw new Error(`nao iniciou: ${inicio.frase}`);
  const envio = await receberVideo({ usuarioId: extra.usuarioId ?? "pv-dono-a", clienteId: extra.clienteId ?? marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe(bytes), tamanhoDoPedido: bytes.length }, dependencias);
  return { id: inicio.publicacaoId, envio };
}

/** O que a Meta faria: pedir o endereço do `video_url` que recebeu, sem cookie. */
function enderecoDoUltimoContainer(): URL {
  const c = dasChamadas("container").at(-1);
  if (!c?.corpo.video_url) throw new Error("nenhum container com video_url");
  return new URL(c.corpo.video_url);
}

function baixar(url: URL, metodo: "GET" | "HEAD" = "GET", cabecalhos: Record<string, string> = {}) {
  // /api/publicar-arquivo/<código>/<nome>
  const partes = url.pathname.split("/");
  const pedido = new Request(url, { method: metodo, headers: cabecalhos });
  return (metodo === "GET" ? baixarArquivo : cabecalhosDoArquivo)(pedido, { params: Promise.resolve({ codigo: decodeURIComponent(partes[3] ?? ""), nome: partes[4] ?? "video.mp4" }) });
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: agoraFixo });
  pasta = mkdtempSync(join(tmpdir(), "teste-publicar-ig-"));
  process.env.PUBLICAR_PASTA_TEMP = pasta;
  await resetarSchema(db());
  config.metaConexao.tokenChave = Buffer.alloc(32, 13).toString("base64");
  config.metaConexao.instagram.appId = "990602627938098";
  config.metaConexao.instagram.appSecret = "segredo-do-app-do-instagram-da-suite";

  const [nicho] = await db().insert(nichos).values({ slug: "publicar-ig-teste", nome: "Publicar IG teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "pv-dono-a", name: "Dono A", email: "pv-dono-a@exemplo.teste", role: "cliente" },
    { id: "pv-membro-a", name: "Membro A", email: "pv-membro-a@exemplo.teste", role: "cliente" },
    { id: "pv-dono-b", name: "Dono B", email: "pv-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "pv-dono-a", nome: "[teste] Marca A", nichoId: nicho.id, perfis },
      { usuarioId: "pv-dono-b", nome: "[teste] Marca B", nichoId: nicho.id, perfis },
    ])
    .returning();
  [marcaA, marcaB] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "pv-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "pv-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "pv-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
}, 30_000);

let roteiroA: number;
let roteiroStoryA: number;
let roteiroB: number;

beforeEach(async () => {
  await db().delete(publicacoes);
  await db().delete(videosCliente);
  await db().delete(roteiros);
  await db().delete(contasConectadas);
  await ligarContaDoInstagram({ clienteId: marcaA, igId: IG_A, token: TOKEN_A, nome: "marca.a" });
  await ligarContaDoInstagram({ clienteId: marcaB, igId: IG_B, token: TOKEN_B, nome: "marca.b" });
  roteiroA = (await criarRoteiro(marcaA)).id;
  roteiroStoryA = (await criarRoteiro(marcaA, { formato: "story" })).id;
  roteiroB = (await criarRoteiro(marcaB)).id;
  mockFetch.mockReset();
  chamadas.length = 0;
  estado.logs.length = 0;
  estado.sessao = null;
  estado.verComo = false;
  estado.barrada = false;
  config.metaConexao.ativa = true;
  config.metaConexao.instagram.ativa = true;
  config.metaConexao.viaFacebookLigada = false;
  config.appUrl = "https://klaki.exemplo.teste";
  instalarInstagram();
});

afterEach(async () => {
  // Em nenhum teste um acesso pode ter ido parar em log nem na tabela de publicações.
  const tudo = JSON.stringify([estado.logs, await db().select().from(publicacoes)]);
  for (const token of TOKENS) expect(tudo, `o acesso ${token} apareceu em log ou na tabela de publicações`).not.toContain(token);
});

afterAll(async () => {
  vi.useRealTimers();
  rmSync(pasta, { recursive: true, force: true });
  delete process.env.PUBLICAR_PASTA_TEMP;
  await getPool().end();
});

// ---------------------------------------------------------------------------
// O fluxo
// ---------------------------------------------------------------------------

describe("Reels pela via do Instagram, do começo ao post", () => {
  it("começar só reserva (lê o limite e não abre contêiner); o vídeo chegando guarda o arquivo e abre o contêiner com o video_url; conferir publica e apaga o arquivo", async () => {
    const dependencias = deps();
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), dependencias);
    if (!inicio.ok) throw new Error(`nao iniciou: ${inicio.frase}`);
    const antes = await linha(inicio.publicacaoId);
    expect(antes).toMatchObject({ estado: "enviando", containerId: null });
    expect(dasChamadas("container")).toHaveLength(0);
    expect(dasChamadas("limite")).toHaveLength(1);
    expect(dasChamadas("limite")[0]).toMatchObject({ host: "graph.instagram.com", token: TOKEN_A });

    const envio = await receberVideo({ usuarioId: "pv-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, dependencias);
    expect(envio).toEqual({ ok: true });
    const depois = await linha(inicio.publicacaoId);
    expect(depois).toMatchObject({ estado: "processando", containerId: "container-ig-1" });
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(true);
    expect(dependencias.agendar).toHaveBeenCalledTimes(1);

    // O contêiner: no graph.instagram.com, pelo acesso da marca A, com o endereço público do vídeo e sem nada de envio retomável.
    const c = dasChamadas("container")[0];
    expect(c).toMatchObject({ host: "graph.instagram.com", metodo: "POST", token: TOKEN_A });
    expect(c.caminho).toBe(`${IG_A}/media`);
    expect(c.corpo).toMatchObject({ media_type: "REELS", caption: "Minha legenda #oferta", share_to_feed: "true" });
    expect(c.corpo).not.toHaveProperty("upload_type");
    expect(c.corpo).not.toHaveProperty("appsecret_proof");
    expect(c.corpo.video_url).toMatch(/^https:\/\/klaki\.exemplo\.teste\/api\/publicar-arquivo\/\d+\.\d+\.[\w-]+\/video\.mp4$/);
    expect(c.query).toEqual({});

    // A Meta baixa o vídeo do endereço, sem cookie nenhum, e recebe exatamente o que a pessoa enviou.
    const baixado = await baixar(enderecoDoUltimoContainer());
    expect(baixado.status).toBe(200);
    expect(baixado.headers.get("content-type")).toBe("video/mp4");
    expect(baixado.headers.get("content-length")).toBe("5");
    expect([...new Uint8Array(await baixado.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);

    // Conferir: pronto (FINISHED), publica, liga o endereço ao roteiro e APAGA o arquivo.
    const conferencia = await conferirPublicacao(inicio.publicacaoId, dependencias);
    expect(conferencia.vista).toMatchObject({ estado: "publicada", permalink: "https://www.instagram.com/reel/IGSIM1/" });
    expect(dasChamadas("status")[0]).toMatchObject({ host: "graph.instagram.com", token: TOKEN_A });
    expect(dasChamadas("publicar")[0]).toMatchObject({ host: "graph.instagram.com", caminho: `${IG_A}/media_publish`, corpo: expect.objectContaining({ creation_id: "container-ig-1" }) });
    expect(dasChamadas("permalink")[0].host).toBe("graph.instagram.com");
    expect(dasChamadas("outra")).toHaveLength(0);
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(false);
    expect((await baixar(enderecoDoUltimoContainer())).status).toBe(404);
    expect((await db().select().from(roteiros).where(eq(roteiros.id, roteiroA)))[0]).toMatchObject({ status: "postado", urlPostado: "https://www.instagram.com/reel/IGSIM1/" });
    expect((await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, roteiroA)))[0]).toMatchObject({ metaMediaId: "midia-ig-1" });
  });

  it("Story: o contêiner é STORIES com o video_url e sem legenda", async () => {
    const { envio } = await iniciarEEnviar(roteiroStoryA, { tipo: "story", legenda: "isso nao vai" });
    expect(envio).toEqual({ ok: true });
    const c = dasChamadas("container")[0];
    expect(c.corpo.media_type).toBe("STORIES");
    expect(c.corpo).not.toHaveProperty("caption");
    expect(c.corpo.video_url).toContain("/api/publicar-arquivo/");
  });

  it("esperando a Meta preparar: IN_PROGRESS segue esperando e o arquivo continua lá; FINISHED depois publica", async () => {
    instalarInstagram({ status: ["IN_PROGRESS", "FINISHED"] });
    const dependencias = deps();
    const { id } = await iniciarEEnviar(roteiroA, {}, [1, 2, 3, 4, 5], dependencias);
    const primeira = await conferirPublicacao(id, dependencias);
    expect(primeira.vista?.estado).toBe("processando");
    expect(primeira.reconferirEmSeg).not.toBeNull();
    expect(existsSync(caminhoDoVideo(id))).toBe(true);
    const segunda = await conferirPublicacao(id, dependencias);
    expect(segunda.vista?.estado).toBe("publicada");
    expect(existsSync(caminhoDoVideo(id))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quando dá errado: o arquivo some em todo fim
// ---------------------------------------------------------------------------

describe("a varredura no worker", () => {
  it("a conferência da fila e o job diário varrem o vídeo velho esquecido, sem depender de alguém subir outro vídeo; o recente fica", async () => {
    const { rodarRenovarContasLigadas } = await import("@/jobs/renovar-contas-ligadas");
    const { rodarConferenciaDaPublicacao } = await import("@/servicos/publicar-instagram");
    const { guardarVideo, IDADE_MAXIMA_MS } = await import("@/lib/video-temporario");
    const { utimesSync } = await import("node:fs");
    for (const id of [9001, 9002, 9003]) await guardarVideo(id, fluxoDe([1, 2, 3]), 3);
    // A idade vem do mtime do arquivo contra o relógio da varredura (congelado em agoraFixo): o velho passou do limite por um minuto, o recente tem um minuto de vida.
    const velho = new Date(agoraFixo.getTime() - IDADE_MAXIMA_MS - 60_000);
    const recente = new Date(agoraFixo.getTime() - 60_000);
    utimesSync(caminhoDoVideo(9001), velho, velho);
    utimesSync(caminhoDoVideo(9002), velho, velho);
    utimesSync(caminhoDoVideo(9003), recente, recente);

    await rodarConferenciaDaPublicacao(99999999, deps());
    // A varredura da conferência roda solta (`void`): espera pelo efeito, não por um tempo fixo.
    await vi.waitFor(() => {
      expect(existsSync(caminhoDoVideo(9001))).toBe(false);
      expect(existsSync(caminhoDoVideo(9002))).toBe(false);
    });
    expect(existsSync(caminhoDoVideo(9003))).toBe(true);

    await guardarVideo(9004, fluxoDe([1]), 1);
    utimesSync(caminhoDoVideo(9004), velho, velho);
    const resumo = await rodarRenovarContasLigadas(agoraFixo);
    expect(resumo.videosVarridos).toBe(1);
    expect(existsSync(caminhoDoVideo(9004))).toBe(false);
    expect(existsSync(caminhoDoVideo(9003))).toBe(true);
  });
});

describe("o arquivo temporário some em todo fim possível", () => {
  it("a Meta não consegue baixar o vídeo (2207052): falhou com a frase de não preparar, e nenhum arquivo fica", async () => {
    instalarInstagram({ erroNoContainer: { code: 100, subcode: 2207052 } });
    const { id, envio } = await iniciarEEnviar(roteiroA);
    expect(envio).toMatchObject({ ok: false, codigo: "nao-preparou", status: 502 });
    expect(await linha(id)).toMatchObject({ estado: "falhou", codigoMeta: 100, subcodigoMeta: 2207052 });
    expect(existsSync(caminhoDoVideo(id))).toBe(false);
  });

  it("a Meta diz ERROR no preparo: falhou, arquivo apagado", async () => {
    instalarInstagram({ status: ["ERROR"] });
    const dependencias = deps();
    const { id } = await iniciarEEnviar(roteiroA, {}, [1, 2, 3, 4, 5], dependencias);
    expect((await conferirPublicacao(id, dependencias)).vista?.estado).toBe("falhou");
    expect(existsSync(caminhoDoVideo(id))).toBe(false);
  });

  it("passou o prazo de preparo da Meta: falhou 'demorou', arquivo apagado", async () => {
    instalarInstagram({ status: ["IN_PROGRESS"] });
    const dependencias = deps();
    const { id } = await iniciarEEnviar(roteiroA, {}, [1, 2, 3, 4, 5], dependencias);
    const tarde = { ...dependencias, agora: () => new Date(agoraFixo.getTime() + PREPARO_DA_META_PRAZO_MS + 1000) };
    const r = await conferirPublicacao(id, tarde);
    expect(r.vista).toMatchObject({ estado: "falhou" });
    expect(existsSync(caminhoDoVideo(id))).toBe(false);
  });

  it("cancelar com o vídeo já enviado: falha 'cancelada', arquivo apagado, endereço morto; o roteiro fica livre para tentar de novo", async () => {
    const { id } = await iniciarEEnviar(roteiroA);
    expect(existsSync(caminhoDoVideo(id))).toBe(true);
    const url = enderecoDoUltimoContainer();
    const vista = await cancelarEnvio("pv-dono-a", marcaA, id, agoraFixo);
    expect(vista?.estado).toBe("falhou");
    expect(existsSync(caminhoDoVideo(id))).toBe(false);
    expect((await baixar(url)).status).toBe(404);
    const outra = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    expect(outra.ok).toBe(true);
  });

  it("o vídeo de outro tamanho que o declarado: 'envio-interrompido', nenhum contêiner aberto, nenhum arquivo", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 10 }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    const menor = await receberVideo({ usuarioId: "pv-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3]), tamanhoDoPedido: 10 }, deps());
    expect(menor).toMatchObject({ ok: false, codigo: "envio-interrompido", status: 400 });
    expect(dasChamadas("container")).toHaveLength(0);
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(false);
    expect((await linha(inicio.publicacaoId)).estado).toBe("falhou");
  });

  it("o Content-Length diferente do declarado também derruba, sem guardar nada", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 5 }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    const r = await receberVideo({ usuarioId: "pv-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5, 6]), tamanhoDoPedido: 6 }, deps());
    expect(r).toMatchObject({ ok: false, codigo: "envio-interrompido" });
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// O endereço público
// ---------------------------------------------------------------------------

describe("o endereço público do vídeo", () => {
  it("serve por pedaços (Range) e responde ao HEAD, só com o código certo", async () => {
    await iniciarEEnviar(roteiroA, {}, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const url = enderecoDoUltimoContainer();

    const cabecalhos = await baixar(url, "HEAD");
    expect(cabecalhos.status).toBe(200);
    expect(cabecalhos.headers.get("content-length")).toBe("10");
    expect(cabecalhos.headers.get("accept-ranges")).toBe("bytes");

    const parte = await baixar(url, "GET", { range: "bytes=2-4" });
    expect(parte.status).toBe(206);
    expect(parte.headers.get("content-range")).toBe("bytes 2-4/10");
    expect([...new Uint8Array(await parte.arrayBuffer())]).toEqual([12, 13, 14]);

    const resto = await baixar(url, "GET", { range: "bytes=7-" });
    expect(resto.status).toBe(206);
    expect([...new Uint8Array(await resto.arrayBuffer())]).toEqual([17, 18, 19]);

    const fim = await baixar(url, "GET", { range: "bytes=-2" });
    expect([...new Uint8Array(await fim.arrayBuffer())]).toEqual([18, 19]);

    expect((await baixar(url, "GET", { range: "bytes=50-60" })).status).toBe(416);
    expect((await baixar(url, "GET", { range: "bytes=abc" })).status).toBe(416);
  });

  it("código adulterado, de outra publicação, vencido, ou lixo: 404, sem dizer o que existe", async () => {
    const { id } = await iniciarEEnviar(roteiroA);
    const url = enderecoDoUltimoContainer();
    const [, , codigo] = url.pathname.split("/").slice(1);
    const [idDoCodigo, vence, assinatura] = codigo.split(".");

    const adulterado = new URL(url);
    adulterado.pathname = `/api/publicar-arquivo/${idDoCodigo}.${vence}.${assinatura.slice(0, -2)}xx/video.mp4`;
    expect((await baixar(adulterado)).status).toBe(404);

    const outraPublicacao = new URL(url);
    outraPublicacao.pathname = `/api/publicar-arquivo/${Number(idDoCodigo) + 1}.${vence}.${assinatura}/video.mp4`;
    expect((await baixar(outraPublicacao)).status).toBe(404);

    const vencido = new URL(url);
    vencido.pathname = `/api/publicar-arquivo/${criarCodigoDoVideo(id, new Date(Date.now() - VALIDADE_DO_ENDERECO_MS - 60_000))}/video.mp4`;
    expect((await baixar(vencido)).status).toBe(404);

    for (const lixo of ["lixo", "1.2", "a%2Fb%2Fc", "1.2.3.4"]) {
      const feio = new URL(url);
      feio.pathname = `/api/publicar-arquivo/${lixo}/video.mp4`;
      const r = await baixar(feio);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
    }
    // O bom continua servindo.
    expect((await baixar(url)).status).toBe(200);
  });

  it("publicação que já terminou (falhou ou publicada) não serve mais, mesmo se o arquivo ainda estivesse em disco", async () => {
    const { id } = await iniciarEEnviar(roteiroA);
    const url = enderecoDoUltimoContainer();
    expect((await baixar(url)).status).toBe(200);
    await db().update(publicacoes).set({ estado: "falhou" }).where(eq(publicacoes.id, id));
    expect(existsSync(caminhoDoVideo(id))).toBe(true);
    expect((await baixar(url)).status).toBe(404);
  });

  it("o endereço de uma marca nunca entrega o vídeo de outra: cada código leva a sua própria publicação", async () => {
    const a = await iniciarEEnviar(roteiroA, {}, [1, 1, 1, 1, 1]);
    const urlA = enderecoDoUltimoContainer();
    const b = await iniciarEEnviar(roteiroB, { usuarioId: "pv-dono-b", clienteId: marcaB }, [2, 2, 2, 2, 2, 2]);
    const urlB = enderecoDoUltimoContainer();
    expect(urlA.pathname).not.toBe(urlB.pathname);
    expect([...new Uint8Array(await (await baixar(urlA)).arrayBuffer())]).toEqual([1, 1, 1, 1, 1]);
    expect([...new Uint8Array(await (await baixar(urlB)).arrayBuffer())]).toEqual([2, 2, 2, 2, 2, 2]);
    // E cada contêiner foi aberto com o acesso da PRÓPRIA marca.
    expect(dasChamadas("container").map((c) => [c.caminho, c.token])).toEqual([
      [`${IG_A}/media`, TOKEN_A],
      [`${IG_B}/media`, TOKEN_B],
    ]);
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// Quem pode, o limite e a rota
// ---------------------------------------------------------------------------

describe("quem pode publicar e o limite do dia", () => {
  it("só o dono: o membro e o dono de outra marca são recusados antes de falar com a Meta", async () => {
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, usuarioId: "pv-membro-a" }), deps())).toMatchObject({ ok: false, codigo: "so-dono" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, usuarioId: "pv-dono-b" }), deps())).toMatchObject({ ok: false, codigo: "so-dono" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("o roteiro de outra marca não existe para esta", async () => {
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroB }), deps())).toMatchObject({ ok: false, codigo: "sem-roteiro" });
    expect(dasChamadas("container")).toHaveLength(0);
  });

  it("conta ligada sem a publicação liberada: recusa, sem tocar na Meta", async () => {
    await db().update(contasConectadas).set({ publicarLiberado: false }).where(eq(contasConectadas.clienteId, marcaA));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "sem-permissao" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("o limite das 24 horas esgotado: recusa, nada reservado", async () => {
    instalarInstagram({ limite: { usadas: 100, total: 100 } });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "limite" });
    expect(await db().select().from(publicacoes)).toHaveLength(0);
  });

  it("a Meta recusa o acesso (190) ao ler o limite: a conta ganha o erro e a pessoa é mandada ligar de novo", async () => {
    mockFetch.mockImplementation(async () => json({ error: { message: "Error validating access token", code: 190 } }, 400));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    const [conta] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, marcaA));
    expect(conta.erro).toContain("Ligue de novo");
  });
});

describe("dois envios do mesmo vídeo ao mesmo tempo (revisão do Fable de 27/10, achado 3)", () => {
  const partesNaPasta = () => readdirSync(pasta).filter((n) => n.endsWith(".parte"));

  it("o segundo, com o primeiro ainda subindo, recebe a recusa em língua de gente e não toca em nada: o primeiro termina, um só contêiner, o arquivo inteiro", async () => {
    const dependencias = deps();
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 10 }), dependencias);
    if (!inicio.ok) throw new Error("nao iniciou");

    let liberar!: () => void;
    const portao = new Promise<void>((resolver) => (liberar = resolver));
    let metade = false;
    const primeiroCorpo = new ReadableStream<Uint8Array>({
      async pull(controle) {
        if (!metade) {
          metade = true;
          controle.enqueue(new Uint8Array([1, 1, 1, 1, 1]));
          return;
        }
        await portao;
        controle.enqueue(new Uint8Array([1, 1, 1, 1, 1]));
        controle.close();
      },
    });
    const entradaBase = { usuarioId: "pv-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, tamanhoDoPedido: 10 };
    const primeiro = receberVideo({ ...entradaBase, corpo: primeiroCorpo }, dependencias);
    // Espera o primeiro estar de fato gravando.
    for (let i = 0; i < 100 && partesNaPasta().length === 0; i += 1) await new Promise((resolver) => setTimeout(resolver, 20));
    expect(partesNaPasta()).toHaveLength(1);

    const segundo = await receberVideo({ ...entradaBase, corpo: fluxoDe([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]) }, dependencias);
    expect(segundo).toMatchObject({ ok: false, codigo: "envio-em-curso", status: 409 });
    if (!segundo.ok) expect(segundo.frase).toBe(fraseDeRecusa("envio-em-curso"));
    // O segundo não derrubou a publicação, não abriu contêiner e não mexeu no arquivo.
    expect((await linha(inicio.publicacaoId)).estado).toBe("enviando");
    expect(dasChamadas("container")).toHaveLength(0);
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(false);
    expect(partesNaPasta()).toHaveLength(1);

    liberar();
    expect(await primeiro).toEqual({ ok: true });
    expect(await linha(inicio.publicacaoId)).toMatchObject({ estado: "processando", containerId: "container-ig-1" });
    expect(dasChamadas("container")).toHaveLength(1);
    expect(readFileSync(caminhoDoVideo(inicio.publicacaoId))).toEqual(Buffer.alloc(10, 1));
    expect(partesNaPasta()).toHaveLength(0);

    // A reserva se soltou: um terceiro envio depois do fim é recusado pelo estado (já processando), não pela reserva, e não apaga o vídeo.
    const terceiro = await receberVideo({ ...entradaBase, corpo: fluxoDe([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]) }, dependencias);
    expect(terceiro).toMatchObject({ ok: false, codigo: "em-andamento", status: 409 });
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(true);
  });

  it("dois PUT disparados juntos pela rota: um recebe 200, o outro 409, um só contêiner e o vídeo intacto", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 400_000 }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    entrar("pv-dono-a");
    const pedidoRota = (n: number): [Request, { params: Promise<{ id: string }> }] => {
      const init: RequestInit & { duplex?: string } = {
        method: "PUT",
        headers: { "content-type": "video/mp4", "content-length": "400000" },
        body: new Uint8Array(400_000).fill(n) as BodyInit,
        duplex: "half",
      };
      return [new Request(`http://localhost/api/publicar/${inicio.publicacaoId}/video`, init), { params: Promise.resolve({ id: String(inicio.publicacaoId) }) }];
    };
    const [a, b] = await Promise.all([enviarVideoRota(...pedidoRota(1)), enviarVideoRota(...pedidoRota(2))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(dasChamadas("container")).toHaveLength(1);
    expect((await linha(inicio.publicacaoId)).estado).toBe("processando");
    const bytes = readFileSync(caminhoDoVideo(inicio.publicacaoId));
    expect(bytes.length).toBe(400_000);
    expect(new Set(bytes).size).toBe(1);
    expect(partesNaPasta()).toHaveLength(0);
  });
});

describe("a rota PUT /api/publicar/[id]/video pela via do Instagram", () => {
  function pedido(id: number, corpo: Uint8Array): [Request, { params: Promise<{ id: string }> }] {
    const init: RequestInit & { duplex?: string } = { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(corpo.byteLength) }, body: corpo as BodyInit, duplex: "half" };
    return [new Request(`http://localhost/api/publicar/${id}/video`, init), { params: Promise.resolve({ id: String(id) }) }];
  }

  it("feliz: 200, a publicação passa a processando pelo acesso da marca da sessão, e o arquivo está guardado", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    entrar("pv-dono-a");
    const r = await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array([1, 2, 3, 4, 5])));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(dasChamadas("container")[0].token).toBe(TOKEN_A);
    expect((await linha(inicio.publicacaoId)).estado).toBe("processando");
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(true);
  });

  it("sem sessão 401; ver como 403; assinatura em dia exigida 402; membro 403; outra marca 404; nada vai à Meta nem ao disco", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    chamadas.length = 0;
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, bytes))).status).toBe(401);
    entrar("pv-dono-a");
    estado.verComo = true;
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, bytes))).status).toBe(403);
    estado.verComo = false;
    estado.barrada = true;
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, bytes))).status).toBe(402);
    estado.barrada = false;
    entrar("pv-membro-a");
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, bytes))).status).toBe(403);
    entrar("pv-dono-b");
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, bytes))).status).toBe(404);
    expect(dasChamadas("container")).toHaveLength(0);
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(false);
    expect((await linha(inicio.publicacaoId)).estado).toBe("enviando");
  });

  it("a Meta não consegue baixar: 502 com a frase em língua de gente, sem código técnico, e nenhum arquivo", async () => {
    instalarInstagram({ erroNoContainer: { code: 100, subcode: 2207052 } });
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    entrar("pv-dono-a");
    const r = await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array([1, 2, 3, 4, 5])));
    expect(r.status).toBe(502);
    const corpo = (await r.json()) as { erro: string };
    expect(corpo.erro).not.toMatch(/2207052|\b100\b/);
    expect(existsSync(caminhoDoVideo(inicio.publicacaoId))).toBe(false);
  });
});
