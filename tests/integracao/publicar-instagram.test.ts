/**
 * E56 PR 1, publicar no Instagram pelo aplicativo, contra o Postgres local e SEM rede: a Graph API e o servidor de envio de vídeo (rupload) são simulados pelo `fetch` (nenhum teste fala com a
 * Meta de verdade; `lib/meta-oauth.ts` recusa rodar dentro do Vitest sem isso). Prova: o fluxo feliz de Reels e de Story (contêiner, envio, espera, publicação, link ligado ao roteiro), o vídeo
 * recusado pela Meta, o limite das 24 horas, a marca sem conta ligada, o isolamento entre marcas (o acesso de cada uma, o que cada uma vê e toca), só o dono, o "ver como" e o portão da
 * cobrança nas ações e na rota, publicar uma vez só (dois toques, duas conferências, resposta perdida) e que o acesso nunca vai para log, retorno nem tabela.
 */
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

import { ENVIO_PARADO_APOS_MS, PREPARO_DA_META_PRAZO_MS, PUBLICANDO_PARADO_APOS_MS } from "@/config/publicacao";
import { db, getPool } from "@/db";
import { clientes, contasConectadas, membrosMarca, nichos, publicacoes, roteiros, user, videosCliente } from "@/db/schema";
import { config } from "@/lib/config";
import { cifrarToken, contextoDoToken } from "@/lib/meta-token";
import { conferirPublicacao, iniciarPublicacao, publicacaoDoRoteiro, receberVideo, rodarConferenciaDaPublicacao, visaoDePublicar, cancelarEnvio } from "@/servicos/publicar-instagram";
import { textosLigacao } from "@/textos/conta-conectada";
import { fraseDeFalha, fraseDeRecusa } from "@/textos/publicar";

import { resetarSchema } from "../../scripts/resetar-schema";

const { PUT: enviarVideoRota } = await import("@/app/api/publicar/[id]/video/route");
const { cancelarEnvioAction, conferirPublicacaoAction, iniciarPublicacaoAction } = await import("@/app/(painel)/(completo)/roteiros/[id]/publicar-acoes");

const TOKEN_A = "EAA-TOKEN-DA-MARCA-A-NUNCA-NO-BANCO";
const TOKEN_B = "EAA-TOKEN-DA-MARCA-B-NUNCA-NO-BANCO";
const TOKEN_D = "EAA-TOKEN-DA-MARCA-D-NUNCA-NO-BANCO";
const TOKENS = [TOKEN_A, TOKEN_B, TOKEN_D];
const IG_A = "17841400000000a01";
const IG_B = "17841400000000b01";
const IG_D = "17841400000000d01";
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let marcaA: number;
let marcaB: number;
let marcaC: number;
let marcaD: number;
let contaA: number;
let nichoId: number;

// ---------------------------------------------------------------------------
// A Meta simulada: Graph API e envio de vídeo
// ---------------------------------------------------------------------------

type Cenario = {
  /** Os `status_code` que o contêiner devolve, um por pergunta; o último se repete. */
  status?: (string | { erro: { code: number; subcode?: number } } | "rede")[];
  /** Erro da Graph API (ou `"rede"`) ao criar o contêiner, ao enviar o vídeo, ao publicar, ao ler o limite. */
  erroNoContainer?: { code: number; subcode?: number } | "rede";
  erroNoEnvio?: { code: number; retriable: boolean } | "rede";
  erroAoPublicar?: { code: number; subcode?: number } | "rede";
  erroNoLimite?: { code: number } | "rede";
  limite?: { usadas: number; total: number | null };
  permalink?: string | null;
  /** Quanto tempo o `media_publish` demora (para duas conferências se cruzarem). */
  demoraNoPublicar?: number;
};

type ChamadaDaMeta = { tipo: "container" | "envio" | "status" | "publicar" | "permalink" | "limite" | "outra"; metodo: string; caminho: string; token: string; corpo: Record<string, string>; cabecalhos: Record<string, string>; bytes?: number };
const chamadas: ChamadaDaMeta[] = [];
let sequencia = 0;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

async function lerBytes(corpo: unknown): Promise<number> {
  if (corpo instanceof Uint8Array) return corpo.byteLength;
  if (corpo instanceof ReadableStream) return (await new Response(corpo).arrayBuffer()).byteLength;
  return 0;
}

function instalarMeta(c: Cenario = {}): void {
  sequencia = 0;
  let perguntas = 0;
  mockFetch.mockImplementation(async (entrada: URL | string, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? "GET";
    const cabecalhos = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const corpoDoFormulario: Record<string, string> = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
    const caminho = url.pathname.replace(/^\/v26\.0\//, "").replace(/^\/ig-api-upload\/v26\.0\//, "");
    const token = corpoDoFormulario.access_token ?? url.searchParams.get("access_token") ?? (cabecalhos.authorization ?? "").replace(/^OAuth /, "");
    const registro = (tipo: ChamadaDaMeta["tipo"], extra: Partial<ChamadaDaMeta> = {}) => chamadas.push({ tipo, metodo, caminho, token, corpo: corpoDoFormulario, cabecalhos, ...extra });

    if (url.host === "rupload.facebook.com") {
      const bytes = await lerBytes(init?.body);
      registro("envio", { bytes });
      if (c.erroNoEnvio === "rede") throw new TypeError("fetch failed");
      if (c.erroNoEnvio) return json({ debug_info: { retriable: c.erroNoEnvio.retriable, type: "ProcessingFailedError", message: JSON.stringify({ success: false, error: { message: "x", code: c.erroNoEnvio.code } }) } }, 400);
      return json({ success: true, message: "Upload successful." });
    }
    if (metodo === "POST" && caminho.endsWith("/media")) {
      registro("container");
      if (c.erroNoContainer === "rede") throw new TypeError("fetch failed");
      if (c.erroNoContainer) return json({ error: { message: "erro simulado", code: c.erroNoContainer.code, error_subcode: c.erroNoContainer.subcode } }, 400);
      sequencia += 1;
      return json({ id: `container-${sequencia}`, uri: `https://rupload.facebook.com/ig-api-upload/v26.0/container-${sequencia}` });
    }
    if (metodo === "POST" && caminho.endsWith("/media_publish")) {
      registro("publicar");
      if (c.demoraNoPublicar) await new Promise((r) => setTimeout(r, c.demoraNoPublicar));
      if (c.erroAoPublicar === "rede") throw new TypeError("fetch failed");
      if (c.erroAoPublicar) return json({ error: { message: "erro simulado", code: c.erroAoPublicar.code, error_subcode: c.erroAoPublicar.subcode } }, 400);
      return json({ id: `midia-${caminho.split("/")[0]}` });
    }
    if (caminho.endsWith("/content_publishing_limit")) {
      registro("limite");
      if (c.erroNoLimite === "rede") throw new TypeError("fetch failed");
      if (c.erroNoLimite) return json({ error: { message: "erro simulado", code: c.erroNoLimite.code } }, 400);
      const limite = c.limite ?? { usadas: 2, total: 50 };
      return json({ data: [{ quota_usage: limite.usadas, ...(limite.total === null ? {} : { config: { quota_total: limite.total, quota_duration: 86400 } }) }] });
    }
    if (url.searchParams.get("fields") === "status_code") {
      registro("status");
      const lista = c.status ?? ["FINISHED"];
      const item = lista[Math.min(perguntas, lista.length - 1)];
      perguntas += 1;
      if (item === "rede") throw new TypeError("fetch failed");
      if (typeof item === "object") return json({ error: { message: "erro simulado", code: item.erro.code, error_subcode: item.erro.subcode } }, 400);
      return json({ status_code: item, id: caminho });
    }
    if (url.searchParams.get("fields") === "permalink") {
      registro("permalink");
      if (c.permalink === null) return json({ error: { message: "erro simulado", code: 100 } }, 400);
      return json({ permalink: c.permalink ?? `https://www.instagram.com/reel/${caminho.replace("midia-", "")}/`, id: caminho });
    }
    registro("outra");
    return json({ error: { message: "caminho desconhecido do simulador", code: 100 } }, 404);
  });
}

const dasChamadas = (tipo: ChamadaDaMeta["tipo"]) => chamadas.filter((c) => c.tipo === tipo);

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

async function ligarConta(o: { clienteId: number; igId: string; token: string; nome: string; publicarLiberado?: boolean; expiraEm?: Date | null; erro?: string | null }) {
  const [linha] = await db()
    .insert(contasConectadas)
    .values({
      clienteId: o.clienteId,
      plataforma: "instagram",
      contaId: o.igId,
      nome: o.nome,
      metaUsuarioId: `meta-${o.clienteId}`,
      estado: "ativa",
      tokenCifrado: cifrarToken(o.token, contextoDoToken(o.clienteId, "instagram", o.igId)),
      tokenExpiraEm: o.expiraEm === undefined ? new Date("2027-06-01T00:00:00Z") : o.expiraEm,
      publicarLiberado: o.publicarLiberado ?? true,
      erro: o.erro ?? null,
      conectadaEm: new Date("2026-10-01T00:00:00Z"),
    })
    .returning();
  return linha;
}

function entrar(usuarioId: string | null): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: "cliente", name: usuarioId }, session: { userId: usuarioId }, verComo: null } : null;
}

const agoraFixo = new Date("2026-10-23T15:00:00Z");

function entradaDeIniciar(extra: Partial<Parameters<typeof iniciarPublicacao>[0]> & { roteiroId: number }): Parameters<typeof iniciarPublicacao>[0] {
  return { usuarioId: "pi-dono-a", clienteId: marcaA, tipo: "reels", legenda: "Minha legenda #oferta", tamanhoBytes: 5, tipoDoArquivo: "video/mp4", nomeDoArquivo: "video.mp4", ...extra };
}

function fluxoDe(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });
}

const deps = (agendar = vi.fn(async () => undefined)) => ({ agora: () => agoraFixo, agendar });

/** Começa e envia (o caminho feliz até `processando`). */
async function iniciarEEnviar(roteiroId: number, extra: Partial<Parameters<typeof iniciarPublicacao>[0]> = {}) {
  const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId, ...extra }), deps());
  if (!inicio.ok) throw new Error(`nao iniciou: ${inicio.frase}`);
  const tamanho = extra.tamanhoBytes ?? 5;
  const envio = await receberVideo({ usuarioId: extra.usuarioId ?? "pi-dono-a", clienteId: extra.clienteId ?? marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe(Array.from({ length: tamanho }, (_, i) => i)), tamanhoDoPedido: tamanho }, deps());
  if (!envio.ok) throw new Error(`nao enviou: ${envio.frase}`);
  return inicio.publicacaoId;
}

async function linha(id: number) {
  const [l] = await db().select().from(publicacoes).where(eq(publicacoes.id, id));
  return l;
}

beforeAll(async () => {
  await resetarSchema(db());
  config.metaConexao.appId = "1078374371332982";
  config.metaConexao.appSecret = "segredo-do-app-da-suite";
  config.metaConexao.loginConfigId = "config-da-suite";
  config.metaConexao.tokenChave = Buffer.alloc(32, 13).toString("base64");
  config.metaConexao.redirectUri = "http://localhost:3000/api/meta/retorno";
  config.metaConexao.ativa = true;

  const [nicho] = await db().insert(nichos).values({ slug: "publicar-instagram-teste", nome: "Publicar Instagram teste", termos: [] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values([
    { id: "pi-dono-a", name: "Dono A", email: "pi-dono-a@exemplo.teste", role: "cliente" },
    { id: "pi-membro-a", name: "Membro A", email: "pi-membro-a@exemplo.teste", role: "cliente" },
    { id: "pi-dono-b", name: "Dono B", email: "pi-dono-b@exemplo.teste", role: "cliente" },
    { id: "pi-dono-c", name: "Dono C", email: "pi-dono-c@exemplo.teste", role: "cliente" },
    { id: "pi-dono-d", name: "Dono D", email: "pi-dono-d@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "pi-dono-a", nome: "[teste] Marca A", nichoId, perfis },
      { usuarioId: "pi-dono-b", nome: "[teste] Marca B", nichoId, perfis },
      { usuarioId: "pi-dono-c", nome: "[teste] Marca C", nichoId, perfis },
      { usuarioId: "pi-dono-d", nome: "[teste] Marca D", nichoId, perfis },
    ])
    .returning();
  [marcaA, marcaB, marcaC, marcaD] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "pi-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "pi-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "pi-dono-b", clienteId: marcaB, papel: "dono" },
    { usuarioId: "pi-dono-c", clienteId: marcaC, papel: "dono" },
    { usuarioId: "pi-dono-d", clienteId: marcaD, papel: "dono" },
  ]);
}, 30_000);

let roteiroA: number;
let roteiroStoryA: number;
let roteiroB: number;
let roteiroC: number;
let roteiroD: number;

beforeEach(async () => {
  await db().delete(publicacoes);
  await db().delete(videosCliente);
  await db().delete(roteiros);
  await db().delete(contasConectadas);
  contaA = (await ligarConta({ clienteId: marcaA, igId: IG_A, token: TOKEN_A, nome: "marca.a" })).id;
  await ligarConta({ clienteId: marcaB, igId: IG_B, token: TOKEN_B, nome: "marca.b" });
  await ligarConta({ clienteId: marcaD, igId: IG_D, token: TOKEN_D, nome: "marca.d", publicarLiberado: false });
  roteiroA = (await criarRoteiro(marcaA)).id;
  roteiroStoryA = (await criarRoteiro(marcaA, { formato: "story" })).id;
  roteiroB = (await criarRoteiro(marcaB)).id;
  roteiroC = (await criarRoteiro(marcaC)).id;
  roteiroD = (await criarRoteiro(marcaD)).id;
  mockFetch.mockReset();
  chamadas.length = 0;
  estado.logs.length = 0;
  estado.sessao = null;
  estado.verComo = false;
  estado.barrada = false;
  config.metaConexao.ativa = true;
  instalarMeta();
});

afterEach(async () => {
  // Em nenhum teste um acesso pode ter ido parar em log nem na tabela de publicações.
  const tudo = JSON.stringify([estado.logs, await db().select().from(publicacoes)]);
  for (const token of TOKENS) expect(tudo, `o acesso ${token} apareceu em log ou na tabela de publicações`).not.toContain(token);
});

afterAll(async () => {
  await getPool().end();
});

// ---------------------------------------------------------------------------
// Começar
// ---------------------------------------------------------------------------

describe("iniciarPublicacao", () => {
  it("Reels: abre o envio na Meta pela conta da marca (retomável, com a legenda e o Feed) e reserva o roteiro", async () => {
    const r = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const contêiner = dasChamadas("container");
    expect(contêiner).toHaveLength(1);
    expect(contêiner[0].caminho).toBe(`${IG_A}/media`);
    expect(contêiner[0].token).toBe(TOKEN_A);
    expect(contêiner[0].corpo).toMatchObject({ media_type: "REELS", upload_type: "resumable", share_to_feed: "true", caption: "Minha legenda #oferta" });
    const l = await linha(r.publicacaoId);
    expect(l).toMatchObject({ clienteId: marcaA, roteiroId: roteiroA, tipo: "reels", estado: "enviando", containerId: "container-1", legenda: "Minha legenda #oferta", tamanhoBytes: 5, criadaPor: "pi-dono-a" });
  });

  it("Story: sem legenda na Meta nem na tabela, e o teto é de 100 MB", async () => {
    const r = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroStoryA, tipo: "story", legenda: "isso nao vai", tamanhoBytes: 99_000_000 }), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dasChamadas("container")[0].corpo).toMatchObject({ media_type: "STORIES", upload_type: "resumable" });
    expect(dasChamadas("container")[0].corpo).not.toHaveProperty("caption");
    expect((await linha(r.publicacaoId)).legenda).toBe("");
  });

  it("o teto de tamanho é de cada tipo: 300 MB no Reels, 100 MB no Story, recusado sem falar com a Meta", async () => {
    const reels = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 300_000_001 }), deps());
    expect(reels).toMatchObject({ ok: false, codigo: "arquivo-grande" });
    if (!reels.ok) expect(reels.frase).toContain("300 MB");
    const story = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroStoryA, tipo: "story", tamanhoBytes: 100_000_001 }), deps());
    expect(story).toMatchObject({ ok: false, codigo: "arquivo-grande" });
    if (!story.ok) expect(story.frase).toContain("100 MB");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await db().select().from(publicacoes)).toHaveLength(0);
  });

  it("só MP4 e MOV (pelo tipo, ou pela extensão quando o aparelho não diz o tipo); vazio e tipo inventado são recusados", async () => {
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tipoDoArquivo: "video/x-msvideo", nomeDoArquivo: "a.avi" }), deps())).toMatchObject({ ok: false, codigo: "arquivo-tipo" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tipoDoArquivo: "", nomeDoArquivo: "a.mkv" }), deps())).toMatchObject({ ok: false, codigo: "arquivo-tipo" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 0 }), deps())).toMatchObject({ ok: false, codigo: "arquivo-vazio" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tipo: "carrossel" }), deps())).toMatchObject({ ok: false, codigo: "tipo-invalido" });
    expect(mockFetch).not.toHaveBeenCalled();
    const mov = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tipoDoArquivo: "", nomeDoArquivo: "Gravacao.MOV" }), deps());
    expect(mov.ok).toBe(true);
  });

  it("legenda acima do que o Instagram aceita é recusada antes de falar com a Meta", async () => {
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, legenda: "a".repeat(2201) }), deps())).toMatchObject({ ok: false, codigo: "legenda-longa" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, legenda: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") }), deps())).toMatchObject({ ok: false, codigo: "legenda-hashtags" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("marca sem Instagram ligado: diz para ligar, e nada vai à Meta", async () => {
    const r = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroC, usuarioId: "pi-dono-c", clienteId: marcaC }), deps());
    expect(r).toMatchObject({ ok: false, codigo: "sem-conta", frase: fraseDeRecusa("sem-conta") });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await db().select().from(publicacoes)).toHaveLength(0);
  });

  it("conta ligada sem a publicação liberada: manda ligar de novo; nada vai à Meta", async () => {
    const r = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroD, usuarioId: "pi-dono-d", clienteId: marcaD }), deps());
    expect(r).toMatchObject({ ok: false, codigo: "sem-permissao" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("acesso recusado, vencido ou ilegível: manda ligar de novo", async () => {
    await db().update(contasConectadas).set({ erro: textosLigacao.erroDaConta.recusada }).where(eq(contasConectadas.id, contaA));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    await db().update(contasConectadas).set({ erro: null, tokenExpiraEm: new Date("2026-10-01T00:00:00Z") }).where(eq(contasConectadas.id, contaA));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    await db().update(contasConectadas).set({ tokenExpiraEm: new Date("2027-06-01T00:00:00Z"), tokenCifrado: "v1.lixo.lixo.lixo" }).where(eq(contasConectadas.id, contaA));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a ligação fechada no ambiente: a publicação não está aberta, e nada vai à Meta", async () => {
    config.metaConexao.ativa = false;
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "nao-configurada" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("limite das 24 horas: com o total usado, recusa sem abrir envio; um a menos, passa", async () => {
    instalarMeta({ limite: { usadas: 50, total: 50 } });
    const r = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    expect(r).toMatchObject({ ok: false, codigo: "limite" });
    expect(dasChamadas("container")).toHaveLength(0);
    expect(await db().select().from(publicacoes)).toHaveLength(0);
    instalarMeta({ limite: { usadas: 49, total: 50 } });
    expect((await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).ok).toBe(true);
  });

  it("sem o total na resposta da Meta, vale o padrão da documentação (50)", async () => {
    instalarMeta({ limite: { usadas: 50, total: null } });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "limite" });
  });

  it("uma falha ao ler o limite que não é do acesso não barra (a Meta recusa na hora de publicar); a do acesso barra e marca a conta", async () => {
    instalarMeta({ erroNoLimite: "rede" });
    expect((await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).ok).toBe(true);
    await db().delete(publicacoes);
    instalarMeta({ erroNoLimite: { code: 190 } });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    const [conta] = await db().select().from(contasConectadas).where(eq(contasConectadas.id, contaA));
    expect(conta.erro).toBe(textosLigacao.erroDaConta.recusada);
  });

  it("só o dono da marca: membro e gente de fora são recusados, sem falar com a Meta", async () => {
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, usuarioId: "pi-membro-a" }), deps())).toMatchObject({ ok: false, codigo: "so-dono" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, usuarioId: "pi-dono-b" }), deps())).toMatchObject({ ok: false, codigo: "so-dono" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("o roteiro de outra marca não existe para esta (mesmo sabendo o número)", async () => {
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroB }), deps())).toMatchObject({ ok: false, codigo: "sem-roteiro" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("o vídeo longo vai para o YouTube: não publica no Instagram", async () => {
    const longo = await criarRoteiro(marcaA, { duracaoDoVideo: "longo" });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: longo.id }), deps())).toMatchObject({ ok: false, codigo: "longo" });
  });

  it("uma publicação viva por roteiro e tipo: o segundo pedido espera; depois de publicada, diz que já foi; o outro tipo é livre", async () => {
    const a = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    expect(a.ok).toBe(true);
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "em-andamento" });
    const story = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tipo: "story" }), deps());
    expect(story.ok).toBe(true);
    if (!a.ok) return;
    await db().update(publicacoes).set({ estado: "publicada" }).where(eq(publicacoes.id, a.publicacaoId));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "ja-publicado" });
  });

  it("dois toques ao mesmo tempo: só um abre o envio", async () => {
    const [x, y] = await Promise.all([iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps()), iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(await db().select().from(publicacoes)).toHaveLength(1);
  });

  it("depois de falhar, dá para tentar de novo; um envio parado há muito libera o roteiro", async () => {
    const primeira = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!primeira.ok) throw new Error("nao iniciou");
    // Parado há pouco: ainda reserva.
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), { ...deps(), agora: () => new Date(agoraFixo.getTime() + 10 * 60 * 1000) })).toMatchObject({ ok: false, codigo: "em-andamento" });
    // Parado há muito: o antigo vira falha com a frase do envio parado e o novo passa.
    const depois = new Date(agoraFixo.getTime() + ENVIO_PARADO_APOS_MS + 60_000);
    const nova = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), { ...deps(), agora: () => depois });
    expect(nova.ok).toBe(true);
    const antiga = await linha(primeira.publicacaoId);
    expect(antiga).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("envio-parado") });
  });

  it("uma publicação presa em processando (a fila caiu, ninguém confere) não tranca o roteiro: passado o prazo da Meta vira falha e o novo envio passa", async () => {
    const id = await iniciarEEnviar(roteiroA);
    expect((await linha(id)).estado).toBe("processando");
    // Antes do prazo ainda reserva.
    const quase = new Date(agoraFixo.getTime() + PREPARO_DA_META_PRAZO_MS - 1000);
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), { ...deps(), agora: () => quase })).toMatchObject({ ok: false, codigo: "em-andamento" });
    expect((await linha(id)).estado).toBe("processando");
    // Passou o prazo: o antigo vira falha com a frase de "demorou" (em língua de gente) e o novo abre.
    const depois = new Date(agoraFixo.getTime() + PREPARO_DA_META_PRAZO_MS + 1000);
    const nova = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), { ...deps(), agora: () => depois });
    expect(nova.ok).toBe(true);
    expect(await linha(id)).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("demorou") });
    expect(dasChamadas("publicar")).toHaveLength(0);
  });

  it("a Meta recusa abrir o envio: a publicação fica falhada com a frase, e o roteiro fica livre para tentar de novo", async () => {
    instalarMeta({ erroNoContainer: { code: 100, subcode: 2207032 } });
    const r = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    expect(r).toMatchObject({ ok: false, codigo: "sem-resposta" });
    const [l] = await db().select().from(publicacoes);
    expect(l).toMatchObject({ estado: "falhou", codigoMeta: 100, subcodigoMeta: 2207032 });
    instalarMeta();
    expect((await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).ok).toBe(true);
  });

  it("se a Meta disser que o acesso não vale (190), a conta ligada ganha o aviso para ligar de novo", async () => {
    instalarMeta({ erroNoContainer: { code: 190 } });
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    const [conta] = await db().select().from(contasConectadas).where(eq(contasConectadas.id, contaA));
    expect(conta.erro).toBe(textosLigacao.erroDaConta.recusada);
  });
});

// ---------------------------------------------------------------------------
// O vídeo
// ---------------------------------------------------------------------------

describe("receberVideo", () => {
  it("repassa os bytes à Meta (offset 0, file_size, o acesso da marca), passa a processando e agenda a primeira conferência", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 5 }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    const agendar = vi.fn(async () => undefined);
    const r = await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps(agendar));
    expect(r).toEqual({ ok: true });
    const envio = dasChamadas("envio");
    expect(envio).toHaveLength(1);
    expect(envio[0]).toMatchObject({ caminho: "container-1", token: TOKEN_A, bytes: 5 });
    expect(envio[0].cabecalhos).toMatchObject({ offset: "0", file_size: "5", "content-length": "5" });
    expect((await linha(inicio.publicacaoId)).estado).toBe("processando");
    expect(agendar).toHaveBeenCalledWith(inicio.publicacaoId, 10);
  });

  it("o tamanho do pedido diferente do declarado ao começar: falha, e nada é enviado à Meta", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 5 }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    const r = await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3]), tamanhoDoPedido: 3 }, deps());
    expect(r).toMatchObject({ ok: false, codigo: "envio-interrompido", status: 400 });
    expect(dasChamadas("envio")).toHaveLength(0);
    expect((await linha(inicio.publicacaoId)).estado).toBe("falhou");
  });

  it("sem o tamanho do pedido (sem Content-Length) ou sem corpo: falha", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 5 }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    expect(await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: null }, deps())).toMatchObject({ ok: false, codigo: "envio-interrompido" });
    expect(dasChamadas("envio")).toHaveLength(0);
  });

  it("o corpo maior ou menor que o declarado é cortado: a Meta nunca recebe um arquivo do tamanho errado como se fosse o certo", async () => {
    // O simulador da Meta lê o fluxo até o fim: o contador do aplicativo derruba o fluxo e o envio falha.
    const maior = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: 3 }), deps());
    if (!maior.ok) throw new Error("nao iniciou");
    expect(await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: maior.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5, 6]), tamanhoDoPedido: 3 }, deps())).toMatchObject({ ok: false });
    expect((await linha(maior.publicacaoId)).estado).toBe("falhou");
    const menor = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroStoryA, tipo: "story", tamanhoBytes: 5 }), deps());
    if (!menor.ok) throw new Error("nao iniciou");
    expect(await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: menor.publicacaoId, corpo: fluxoDe([1, 2, 3]), tamanhoDoPedido: 5 }, deps())).toMatchObject({ ok: false });
    expect((await linha(menor.publicacaoId)).estado).toBe("falhou");
  });

  it("a Meta recusa o formato: falha com a frase do formato e o código guardado só para diagnóstico", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    instalarMeta({ erroNoEnvio: { code: 352, retriable: false } });
    const r = await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps());
    expect(r).toMatchObject({ ok: false, status: 502 });
    const l = await linha(inicio.publicacaoId);
    expect(l.estado).toBe("falhou");
    expect(l.codigoMeta).toBe(352);
    expect(l.motivo).toBeTruthy();
    expect(l.motivo).not.toContain("352");
  });

  it("a rede cai no envio: falha pedindo para tentar de novo; o roteiro fica livre", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    instalarMeta({ erroNoEnvio: "rede" });
    const r = await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps());
    expect(r).toMatchObject({ ok: false, codigo: "sem-resposta" });
    instalarMeta();
    expect((await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).ok).toBe(true);
  });

  it("o acesso recusado no envio (190) marca a conta para ligar de novo", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    instalarMeta({ erroNoEnvio: { code: 190, retriable: false } });
    await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps());
    const [conta] = await db().select().from(contasConectadas).where(eq(contasConectadas.id, contaA));
    expect(conta.erro).toBe(textosLigacao.erroDaConta.recusada);
  });

  it("outra marca não envia vídeo para a publicação de A: não acha, nada vai à Meta, a de A fica como estava", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    chamadas.length = 0;
    const r = await receberVideo({ usuarioId: "pi-dono-b", clienteId: marcaB, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps());
    expect(r).toMatchObject({ ok: false, codigo: "nao-achou", status: 404 });
    expect(chamadas).toHaveLength(0);
    expect((await linha(inicio.publicacaoId)).estado).toBe("enviando");
  });

  it("membro que não é dono não envia (403); publicação que não está subindo não aceita vídeo (409)", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    expect(await receberVideo({ usuarioId: "pi-membro-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps())).toMatchObject({ ok: false, codigo: "so-dono", status: 403 });
    await db().update(publicacoes).set({ estado: "processando" }).where(eq(publicacoes.id, inicio.publicacaoId));
    expect(await receberVideo({ usuarioId: "pi-dono-a", clienteId: marcaA, publicacaoId: inicio.publicacaoId, corpo: fluxoDe([1, 2, 3, 4, 5]), tamanhoDoPedido: 5 }, deps())).toMatchObject({ ok: false, codigo: "em-andamento", status: 409 });
    expect(dasChamadas("envio")).toHaveLength(0);
  });

  it("cancelar o envio: só o dono, só da própria marca, só enquanto sobe", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    expect(await cancelarEnvio("pi-dono-b", marcaB, inicio.publicacaoId)).toBeNull();
    expect(await cancelarEnvio("pi-membro-a", marcaA, inicio.publicacaoId)).toBeNull();
    expect((await linha(inicio.publicacaoId)).estado).toBe("enviando");
    expect(await cancelarEnvio("pi-dono-a", marcaA, inicio.publicacaoId)).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("envio-interrompido") });
    // Já publicada: cancelar não mexe.
    const outra = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!outra.ok) throw new Error("nao iniciou");
    await db().update(publicacoes).set({ estado: "publicada" }).where(eq(publicacoes.id, outra.publicacaoId));
    expect(await cancelarEnvio("pi-dono-a", marcaA, outra.publicacaoId)).toMatchObject({ estado: "publicada" });
  });

  it("cancelar também vale enquanto a Meta prepara o vídeo: vira falha \"cancelada\", nada é publicado e o roteiro fica livre", async () => {
    instalarMeta({ status: ["IN_PROGRESS"] });
    const id = await iniciarEEnviar(roteiroA);
    expect((await linha(id)).estado).toBe("processando");
    // Só o dono, só da própria marca.
    expect(await cancelarEnvio("pi-dono-b", marcaB, id)).toBeNull();
    expect(await cancelarEnvio("pi-membro-a", marcaA, id)).toBeNull();
    expect((await linha(id)).estado).toBe("processando");
    expect(await cancelarEnvio("pi-dono-a", marcaA, id)).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("cancelada") });
    expect(fraseDeFalha("cancelada")).toContain("Nada foi publicado");
    expect((await linha(id)).terminadaEm).toBeTruthy();
    // A conferência que chegar depois não faz nada (nem publica).
    chamadas.length = 0;
    expect((await conferirPublicacao(id, deps())).vista?.estado).toBe("falhou");
    expect(chamadas).toHaveLength(0);
    expect(dasChamadas("publicar")).toHaveLength(0);
    // O roteiro está livre.
    expect((await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps())).ok).toBe(true);
  });

  it("depois de mandar publicar (publicando) não cancela: o pedido já saiu e pode ter dado certo", async () => {
    const id = await iniciarEEnviar(roteiroA);
    await db().update(publicacoes).set({ estado: "publicando" }).where(eq(publicacoes.id, id));
    expect(await cancelarEnvio("pi-dono-a", marcaA, id)).toMatchObject({ estado: "publicando", motivo: null });
    expect((await linha(id)).estado).toBe("publicando");
  });
});

// ---------------------------------------------------------------------------
// Conferir e publicar
// ---------------------------------------------------------------------------

describe("conferirPublicacao", () => {
  const em = (segundos: number) => ({ agora: () => new Date(agoraFixo.getTime() + segundos * 1000), agendar: vi.fn(async () => undefined) });

  it("o prazo é de tempo, não de contagem: nove perguntas em 54 segundos (a tela de antes) não reprovam, e a Meta só desiste depois de 6 minutos", async () => {
    instalarMeta({ status: ["IN_PROGRESS"] });
    const id = await iniciarEEnviar(roteiroA);
    for (let i = 0; i < 9; i += 1) {
      const r = await conferirPublicacao(id, em(i * 6));
      expect(r.vista?.estado).toBe("processando");
      expect(r.reconferirEmSeg).not.toBeNull();
    }
    expect(dasChamadas("status")).toHaveLength(9);
    // Dez, vinte, cem perguntas seguidas no mesmo minuto: ainda processando, o relógio é que manda.
    for (let i = 0; i < 20; i += 1) expect((await conferirPublicacao(id, em(59))).vista?.estado).toBe("processando");
    expect(await linha(id)).toMatchObject({ estado: "processando", motivo: null });
    // Passou o prazo e a Meta ainda diz "preparando": falha dizendo que demorou, sem nunca publicar.
    const r = await conferirPublicacao(id, em(PREPARO_DA_META_PRAZO_MS / 1000));
    expect(r).toMatchObject({ reconferirEmSeg: null, vista: { estado: "falhou", motivo: fraseDeFalha("demorou") } });
    expect(await linha(id)).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("demorou") });
    expect(dasChamadas("publicar")).toHaveLength(0);
  });

  it("seguindo o reconferirEmSeg que o servidor devolve: 10, 20, 30, 45 e 60 segundos, no máximo uma pergunta por minuto depois disso, e a última no prazo de 6 minutos", async () => {
    instalarMeta({ status: ["IN_PROGRESS"] });
    const id = await iniciarEEnviar(roteiroA);
    const esperas: number[] = [];
    const instantes: number[] = [];
    let t = 0;
    for (let i = 0; i < 40; i += 1) {
      const r = await conferirPublicacao(id, em(t));
      instantes.push(t);
      if (r.reconferirEmSeg === null) break;
      esperas.push(r.reconferirEmSeg);
      t += r.reconferirEmSeg;
    }
    expect(esperas.slice(0, 5)).toEqual([10, 20, 30, 45, 60]);
    // A última espera é cortada para cair no prazo; fora ela, nunca passa de 60 s.
    expect(Math.max(...esperas)).toBe(60);
    expect(instantes.at(-1)).toBe(PREPARO_DA_META_PRAZO_MS / 1000);
    // Cerca de dez perguntas em 6 minutos, não nove em um.
    expect(dasChamadas("status").length).toBeGreaterThanOrEqual(8);
    expect(dasChamadas("status").length).toBeLessThanOrEqual(11);
    expect(await linha(id)).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("demorou") });
  });

  it("pronto na última pergunta, mesmo depois dos 6 minutos: publica (o prazo só vale para quem ainda está preparando)", async () => {
    instalarMeta({ status: ["FINISHED"] });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, em(PREPARO_DA_META_PRAZO_MS / 1000 + 120));
    expect(r.vista?.estado).toBe("publicada");
    expect(dasChamadas("publicar")).toHaveLength(1);
  });

  it("a conferência não mexe no relógio do prazo, e a Meta pedir para esperar (2207027) também não o reinicia", async () => {
    instalarMeta({ status: ["IN_PROGRESS", "FINISHED"], erroAoPublicar: { code: 9007, subcode: 2207027 } });
    const id = await iniciarEEnviar(roteiroA);
    const inicial = (await linha(id)).atualizadaEm.getTime();
    await conferirPublicacao(id, em(30));
    expect((await linha(id)).atualizadaEm.getTime()).toBe(inicial);
    const r = await conferirPublicacao(id, em(120));
    expect(r.vista?.estado).toBe("processando");
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect(await linha(id)).toMatchObject({ estado: "processando", conferencias: 2 });
    expect((await linha(id)).atualizadaEm.getTime()).toBe(inicial);
  });

  it("uma pergunta que a Meta devolve com limite de pedidos também conta só pelo relógio", async () => {
    instalarMeta({ status: [{ erro: { code: 4 } }] });
    const id = await iniciarEEnviar(roteiroA);
    for (let i = 0; i < 12; i += 1) expect((await conferirPublicacao(id, em(i * 5))).vista?.estado).toBe("processando");
    expect((await conferirPublicacao(id, em(PREPARO_DA_META_PRAZO_MS / 1000))).vista).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("demorou") });
  });

  it("Reels pronto: publica uma vez, guarda o link e liga ao roteiro (o postei vira automático, com a curva já apontando para a mídia)", async () => {
    instalarMeta({ status: ["IN_PROGRESS", "FINISHED"] });
    const id = await iniciarEEnviar(roteiroA);
    expect((await conferirPublicacao(id, deps())).reconferirEmSeg).toBe(10);
    const r = await conferirPublicacao(id, deps());
    expect(r.reconferirEmSeg).toBeNull();
    expect(r.vista?.estado).toBe("publicada");
    expect(r.vista?.permalink).toMatch(/^https:\/\/www\.instagram\.com\/reel\//);
    const publicar = dasChamadas("publicar");
    expect(publicar).toHaveLength(1);
    expect(publicar[0]).toMatchObject({ caminho: `${IG_A}/media_publish`, token: TOKEN_A });
    expect(publicar[0].corpo.creation_id).toBe("container-1");

    const l = await linha(id);
    expect(l).toMatchObject({ estado: "publicada", midiaId: `midia-${IG_A}`, motivo: null });
    expect(l.permalink).toMatch(/^https:\/\/www\.instagram\.com\/reel\//);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroA));
    expect(roteiro).toMatchObject({ status: "postado", urlPostado: l.permalink });
    expect(roteiro.postadoEm).toBeTruthy();
    const [video] = await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, roteiroA));
    expect(video).toMatchObject({ clienteId: marcaA, plataforma: "instagram", url: l.permalink, metaMediaId: `midia-${IG_A}` });
    expect(video.idExterno).toBeTruthy();
  });

  it("Story publicado: o roteiro vira postado e a mídia fica ligada; o link de Story não tem código curto, então a curva dos Reels não o mede", async () => {
    instalarMeta({ permalink: "https://www.instagram.com/stories/marca.a/3400000000000000001/" });
    const id = await iniciarEEnviar(roteiroStoryA, { tipo: "story" });
    await conferirPublicacao(id, deps());
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroStoryA));
    expect(roteiro.status).toBe("postado");
    const [video] = await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, roteiroStoryA));
    expect(video).toMatchObject({ plataforma: "instagram", idExterno: null });
  });

  it("sem o link da mídia (a Meta não devolveu), o roteiro aponta para o perfil e a publicação segue publicada", async () => {
    instalarMeta({ permalink: null });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, deps());
    expect(r.vista).toMatchObject({ estado: "publicada", permalink: null });
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroA));
    expect(roteiro.urlPostado).toBe("https://www.instagram.com/marca.a/");
  });

  it("roteiro que a pessoa já tinha marcado como postado não ganha um segundo vídeo para a curva", async () => {
    const id = await iniciarEEnviar(roteiroA);
    await db().update(roteiros).set({ status: "postado", urlPostado: "https://www.instagram.com/reel/JAEXISTE/", postadoEm: new Date() }).where(eq(roteiros.id, roteiroA));
    await conferirPublicacao(id, deps());
    expect((await linha(id)).estado).toBe("publicada");
    expect(await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, roteiroA))).toHaveLength(0);
  });

  it("vídeo recusado pela Meta ao preparar (ERROR) ou vencido (EXPIRED): falha com a frase do que conferir, sem publicar", async () => {
    for (const status of ["ERROR", "EXPIRED"]) {
      await db().delete(publicacoes);
      instalarMeta({ status: [status] });
      const id = await iniciarEEnviar(roteiroA);
      const r = await conferirPublicacao(id, deps());
      expect(r.vista).toMatchObject({ estado: "falhou" });
      expect(r.vista?.motivo).toBe(fraseDeFalha("nao-preparou", "reels"));
      expect(r.reconferirEmSeg).toBeNull();
      expect(dasChamadas("publicar")).toHaveLength(0);
      chamadas.length = 0;
    }
  });

  it("duas conferências ao mesmo tempo (a tela e o worker) publicam uma vez só", async () => {
    instalarMeta({ demoraNoPublicar: 80 });
    const id = await iniciarEEnviar(roteiroA);
    await Promise.all([conferirPublicacao(id, deps()), conferirPublicacao(id, deps()), conferirPublicacao(id, deps())]);
    expect(dasChamadas("publicar")).toHaveLength(1);
    expect((await linha(id)).estado).toBe("publicada");
    expect(await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, roteiroA))).toHaveLength(1);
  });

  it("a resposta do publicar se perde (rede): não sabemos se saiu, então falha dizendo para conferir o Instagram, e nunca tenta de novo sozinho", async () => {
    instalarMeta({ erroAoPublicar: "rede" });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, deps());
    expect(r.vista).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("nao-confirmou") });
    await conferirPublicacao(id, deps());
    expect(dasChamadas("publicar")).toHaveLength(1);
  });

  it("a Meta diz que ainda não liberou (2207027): volta a esperar em vez de falhar", async () => {
    instalarMeta({ erroAoPublicar: { code: 9007, subcode: 2207027 } });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, deps());
    expect(r.vista?.estado).toBe("processando");
    expect(r.reconferirEmSeg).toBe(10);
  });

  it("a Meta recusa publicar por limite do dia: falha com a frase do limite", async () => {
    instalarMeta({ erroAoPublicar: { code: 9, subcode: 2207042 } });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, deps());
    expect(r.vista).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("limite-do-dia") });
  });

  it("o acesso recusado ao perguntar (190): falha, e a conta ligada ganha o aviso para ligar de novo", async () => {
    instalarMeta({ status: [{ erro: { code: 190 } }] });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, deps());
    expect(r.vista).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("acesso-perdido") });
    const [conta] = await db().select().from(contasConectadas).where(eq(contasConectadas.id, contaA));
    expect(conta.erro).toBe(textosLigacao.erroDaConta.recusada);
  });

  it("uma pergunta que falha por rede não derruba a publicação: pergunta de novo", async () => {
    instalarMeta({ status: ["rede", "FINISHED"] });
    const id = await iniciarEEnviar(roteiroA);
    const primeira = await conferirPublicacao(id, deps());
    expect(primeira.vista?.estado).toBe("processando");
    expect(primeira.reconferirEmSeg).toBe(10);
    expect((await conferirPublicacao(id, deps())).vista?.estado).toBe("publicada");
  });

  it("o contêiner já aparece como PUBLICADO (a resposta anterior se perdeu): fica publicada, sem publicar de novo e sem inventar link", async () => {
    instalarMeta({ status: ["PUBLISHED"] });
    const id = await iniciarEEnviar(roteiroA);
    const r = await conferirPublicacao(id, deps());
    expect(r.vista).toMatchObject({ estado: "publicada", permalink: null });
    expect(dasChamadas("publicar")).toHaveLength(0);
  });

  it("publicando há mais de 3 minutos sem desfecho: falha como não confirmado, sem chamar a Meta", async () => {
    const id = await iniciarEEnviar(roteiroA);
    await db().update(publicacoes).set({ estado: "publicando", atualizadaEm: agoraFixo }).where(eq(publicacoes.id, id));
    chamadas.length = 0;
    const r = await conferirPublicacao(id, { ...deps(), agora: () => new Date(agoraFixo.getTime() + PUBLICANDO_PARADO_APOS_MS + 1000) });
    expect(r.vista).toMatchObject({ estado: "falhou", motivo: fraseDeFalha("nao-confirmou") });
    expect(chamadas).toHaveLength(0);
  });

  it("publicação que não está processando não faz nada: nada vai à Meta", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    chamadas.length = 0;
    const r = await conferirPublicacao(inicio.publicacaoId, deps());
    expect(r.vista?.estado).toBe("enviando");
    expect(r.reconferirEmSeg).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it("a conferência da tela só alcança a marca da sessão: B não vê nem move a publicação de A", async () => {
    const id = await iniciarEEnviar(roteiroA);
    chamadas.length = 0;
    const r = await conferirPublicacao(id, { ...deps(), clienteId: marcaB });
    expect(r).toEqual({ vista: null, reconferirEmSeg: null });
    expect(chamadas).toHaveLength(0);
    expect((await linha(id)).estado).toBe("processando");
  });

  it("o worker confere e agenda a próxima; ao terminar, não agenda mais", async () => {
    instalarMeta({ status: ["IN_PROGRESS", "FINISHED"] });
    const id = await iniciarEEnviar(roteiroA);
    const agendar = vi.fn(async () => undefined);
    expect(await rodarConferenciaDaPublicacao(id, deps(agendar))).toMatchObject({ publicacaoId: id, estado: "processando", reconferirEmSeg: 10 });
    expect(agendar).toHaveBeenCalledWith(id, 10);
    agendar.mockClear();
    expect(await rodarConferenciaDaPublicacao(id, deps(agendar))).toMatchObject({ estado: "publicada", reconferirEmSeg: null });
    expect(agendar).not.toHaveBeenCalled();
  });

  it("o resumo do worker nunca leva o acesso, o link nem o nome da conta", async () => {
    const id = await iniciarEEnviar(roteiroA);
    const resumo = JSON.stringify(await rodarConferenciaDaPublicacao(id, deps()));
    for (const proibido of [...TOKENS, "marca.a", "instagram.com"]) expect(resumo).not.toContain(proibido);
  });
});

// ---------------------------------------------------------------------------
// Isolamento entre marcas
// ---------------------------------------------------------------------------

describe("isolamento entre marcas", () => {
  it("cada marca publica pelo acesso da própria conta: nenhuma chamada de A leva o acesso de B, e vice-versa", async () => {
    const idA = await iniciarEEnviar(roteiroA);
    const idB = await iniciarEEnviar(roteiroB, { usuarioId: "pi-dono-b", clienteId: marcaB });
    await conferirPublicacao(idA, deps());
    await conferirPublicacao(idB, deps());
    const deA = chamadas.filter((c) => c.caminho.startsWith(IG_A) || c.caminho === "container-1" || c.caminho === `midia-${IG_A}`);
    const deB = chamadas.filter((c) => c.caminho.startsWith(IG_B) || c.caminho === "container-2" || c.caminho === `midia-${IG_B}`);
    expect(deA.length).toBeGreaterThanOrEqual(5);
    expect(deB.length).toBeGreaterThanOrEqual(5);
    expect(new Set(deA.map((c) => c.token))).toEqual(new Set([TOKEN_A]));
    expect(new Set(deB.map((c) => c.token))).toEqual(new Set([TOKEN_B]));
    // Cada publicação saiu na conta da própria marca.
    expect(dasChamadas("publicar").map((c) => c.caminho).sort()).toEqual([`${IG_A}/media_publish`, `${IG_B}/media_publish`].sort());
  });

  it("uma marca não vê a publicação do roteiro de outra, mesmo sabendo os números", async () => {
    const id = await iniciarEEnviar(roteiroA);
    expect(await publicacaoDoRoteiro(marcaB, roteiroA)).toBeNull();
    expect(await publicacaoDoRoteiro(marcaA, roteiroA)).toMatchObject({ id });
    expect(await publicacaoDoRoteiro(marcaA, roteiroB)).toBeNull();
  });

  it("o acesso cifrado copiado para a linha de outra marca não abre: a publicação da B não usa o acesso de A", async () => {
    const [linhaA] = await db().select().from(contasConectadas).where(eq(contasConectadas.id, contaA));
    await db().update(contasConectadas).set({ tokenCifrado: linhaA.tokenCifrado }).where(eq(contasConectadas.clienteId, marcaB));
    expect(await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroB, usuarioId: "pi-dono-b", clienteId: marcaB }), deps())).toMatchObject({ ok: false, codigo: "acesso-perdido" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A tela do roteiro
// ---------------------------------------------------------------------------

describe("visaoDePublicar", () => {
  const verRoteiro = async (id: number) => (await db().select().from(roteiros).where(eq(roteiros.id, id)))[0];

  it("o dono com a conta pronta: pode, com a legenda do roteiro e o tipo do roteiro", async () => {
    const reels = await visaoDePublicar({ usuarioId: "pi-dono-a", clienteId: marcaA, roteiro: await verRoteiro(roteiroA), verComo: false }, agoraFixo);
    expect(reels).toMatchObject({ situacao: { pode: true, conta: "marca.a" }, tipoInicial: "reels", legenda: "Três erros ao lavar a louça\n\nChame no WhatsApp.", megas: { reels: 300, story: 100 }, publicacao: null });
    const story = await visaoDePublicar({ usuarioId: "pi-dono-a", clienteId: marcaA, roteiro: await verRoteiro(roteiroStoryA), verComo: false }, agoraFixo);
    expect(story?.tipoInicial).toBe("story");
  });

  it("a função some no ver como, para quem não é dono, no vídeo longo e com a publicação fechada", async () => {
    const r = await verRoteiro(roteiroA);
    expect(await visaoDePublicar({ usuarioId: "pi-dono-a", clienteId: marcaA, roteiro: r, verComo: true })).toBeNull();
    expect(await visaoDePublicar({ usuarioId: "pi-membro-a", clienteId: marcaA, roteiro: r, verComo: false })).toBeNull();
    const longo = await criarRoteiro(marcaA, { duracaoDoVideo: "longo" });
    expect(await visaoDePublicar({ usuarioId: "pi-dono-a", clienteId: marcaA, roteiro: longo, verComo: false })).toBeNull();
    config.metaConexao.ativa = false;
    expect(await visaoDePublicar({ usuarioId: "pi-dono-a", clienteId: marcaA, roteiro: r, verComo: false })).toBeNull();
  });

  it("sem conta ligada ou sem a publicação liberada, aparece e explica o caminho", async () => {
    const semConta = await visaoDePublicar({ usuarioId: "pi-dono-c", clienteId: marcaC, roteiro: await verRoteiro(roteiroC), verComo: false });
    expect(semConta?.situacao).toEqual({ pode: false, codigo: "sem-conta", frase: fraseDeRecusa("sem-conta") });
    const semPermissao = await visaoDePublicar({ usuarioId: "pi-dono-d", clienteId: marcaD, roteiro: await verRoteiro(roteiroD), verComo: false });
    expect(semPermissao?.situacao).toMatchObject({ pode: false, codigo: "sem-permissao" });
  });

  it("leva a publicação mais recente do roteiro, e nada do acesso", async () => {
    const id = await iniciarEEnviar(roteiroA);
    const v = await visaoDePublicar({ usuarioId: "pi-dono-a", clienteId: marcaA, roteiro: await verRoteiro(roteiroA), verComo: false }, agoraFixo);
    expect(v?.publicacao).toEqual({ id, tipo: "reels", estado: "processando", motivo: null, permalink: null });
    const texto = JSON.stringify(v);
    for (const proibido of [...TOKENS, "container-"]) expect(texto).not.toContain(proibido);
  });
});

// ---------------------------------------------------------------------------
// As ações e a rota
// ---------------------------------------------------------------------------

describe("as ações da tela", () => {
  const dados = { tipo: "reels", legenda: "Legenda", tamanhoBytes: 5, tipoDoArquivo: "video/mp4", nomeDoArquivo: "v.mp4" };

  it("o dono começa a publicação; a marca vem da sessão, nunca de um parâmetro", async () => {
    entrar("pi-dono-a");
    const r = await iniciarPublicacaoAction(roteiroA, dados);
    expect(r.ok).toBe(true);
    expect(dasChamadas("container")[0].caminho).toBe(`${IG_A}/media`);
    // O dono de B tentando o roteiro de A: o roteiro não existe na marca dele.
    entrar("pi-dono-b");
    expect(await iniciarPublicacaoAction(roteiroA, dados)).toMatchObject({ ok: false, erro: fraseDeRecusa("sem-roteiro") });
  });

  it("o ver como nunca: nem começa, nem confere, nem cancela, e nada vai à Meta", async () => {
    entrar("pi-dono-a");
    const id = await iniciarEEnviar(roteiroA);
    chamadas.length = 0;
    estado.verComo = true;
    for (const r of [await iniciarPublicacaoAction(roteiroStoryA, { ...dados, tipo: "story" }), await conferirPublicacaoAction(id), await cancelarEnvioAction(id)]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erro).toBe("Desligado no modo ver como.");
    }
    expect(chamadas).toHaveLength(0);
    expect((await linha(id)).estado).toBe("processando");
  });

  it("o portão da cobrança vem antes de qualquer coisa: marca barrada não abre envio nem confere", async () => {
    entrar("pi-dono-a");
    estado.barrada = true;
    await expect(iniciarPublicacaoAction(roteiroA, dados)).rejects.toThrow("REDIRECT:/assinar");
    await expect(conferirPublicacaoAction(1)).rejects.toThrow("REDIRECT:/assinar");
    await expect(cancelarEnvioAction(1)).rejects.toThrow("REDIRECT:/assinar");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await db().select().from(publicacoes)).toHaveLength(0);
  });

  it("sem sessão, e ids que não são do banco, voltam como recusa (nunca como erro do servidor)", async () => {
    entrar(null);
    expect(await iniciarPublicacaoAction(roteiroA, dados)).toMatchObject({ ok: false });
    entrar("pi-dono-a");
    for (const ruim of [0, -1, 1.5, Number.NaN, 99_999_999_999]) {
      expect(await iniciarPublicacaoAction(ruim, dados)).toMatchObject({ ok: false });
      expect(await conferirPublicacaoAction(ruim)).toMatchObject({ ok: false });
      expect(await cancelarEnvioAction(ruim)).toMatchObject({ ok: false });
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("conferir pela tela: o dono recebe a vista; o membro não; a marca de fora não alcança", async () => {
    const id = await iniciarEEnviar(roteiroA);
    entrar("pi-membro-a");
    expect(await conferirPublicacaoAction(id)).toMatchObject({ ok: false, erro: fraseDeRecusa("so-dono") });
    entrar("pi-dono-b");
    expect(await conferirPublicacaoAction(id)).toMatchObject({ ok: false, erro: fraseDeRecusa("nao-achou") });
    entrar("pi-dono-a");
    const r = await conferirPublicacaoAction(id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dado.vista.estado).toBe("publicada");
  });

  it("a conferência da tela devolve em quantos segundos perguntar de novo (a folha obedece a esse número); terminada, devolve nulo", async () => {
    instalarMeta({ status: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const id = await iniciarEEnviar(roteiroA);
    // A ação usa o relógio de verdade: o vídeo acabou de subir.
    await db().update(publicacoes).set({ atualizadaEm: new Date() }).where(eq(publicacoes.id, id));
    entrar("pi-dono-a");
    const primeira = await conferirPublicacaoAction(id);
    expect(primeira).toMatchObject({ ok: true, dado: { reconferirEmSeg: 10 } });
    const segunda = await conferirPublicacaoAction(id);
    expect(segunda).toMatchObject({ ok: true, dado: { reconferirEmSeg: 20 } });
    const terceira = await conferirPublicacaoAction(id);
    expect(terceira).toMatchObject({ ok: true, dado: { reconferirEmSeg: null, vista: { estado: "publicada" } } });
  });

  it("cancelar pela tela enquanto a Meta prepara: o dono cancela; o membro e a marca de fora não", async () => {
    instalarMeta({ status: ["IN_PROGRESS"] });
    const id = await iniciarEEnviar(roteiroA);
    entrar("pi-membro-a");
    expect(await cancelarEnvioAction(id)).toMatchObject({ ok: false });
    entrar("pi-dono-b");
    expect(await cancelarEnvioAction(id)).toMatchObject({ ok: false, erro: fraseDeRecusa("nao-achou") });
    entrar("pi-dono-a");
    expect(await cancelarEnvioAction(id)).toMatchObject({ ok: true, dado: { vista: { estado: "falhou", motivo: fraseDeFalha("cancelada") } } });
  });
});

describe("a rota PUT /api/publicar/[id]/video", () => {
  function pedido(id: string | number, corpo: Uint8Array | null, extra: Record<string, string> = {}): [Request, { params: Promise<{ id: string }> }] {
    const headers: Record<string, string> = { "content-type": "video/mp4", ...(corpo ? { "content-length": String(corpo.byteLength) } : {}), ...extra };
    const init: RequestInit & { duplex?: string } = { method: "PUT", headers, ...(corpo ? { body: corpo as BodyInit, duplex: "half" } : {}) };
    return [new Request(`http://localhost/api/publicar/${id}/video`, init), { params: Promise.resolve({ id: String(id) }) }];
  }

  it("feliz: 200 e a publicação passa a processando, pelo acesso da marca da sessão", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    entrar("pi-dono-a");
    const resposta = await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array([1, 2, 3, 4, 5])));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
    expect(dasChamadas("envio")[0]).toMatchObject({ token: TOKEN_A, bytes: 5 });
    expect((await linha(inicio.publicacaoId)).estado).toBe("processando");
  });

  it("um corpo grande e lento (24 MB em pedaços de 1 MB, um a cada 40 ms) passa inteiro, em fluxo e sem prazo próprio da rota: o limite está no servidor do Node, não aqui", async () => {
    const megas = 24;
    const tamanho = megas * 1_000_000;
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA, tamanhoBytes: tamanho }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    entrar("pi-dono-a");
    let enviados = 0;
    const lento = new ReadableStream<Uint8Array>({
      async pull(controle) {
        if (enviados >= megas) return controle.close();
        await new Promise((r) => setTimeout(r, 40));
        enviados += 1;
        controle.enqueue(new Uint8Array(1_000_000));
      },
    });
    const pedidoLento = new Request(`http://localhost/api/publicar/${inicio.publicacaoId}/video`, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-length": String(tamanho) },
      body: lento,
      duplex: "half",
    } as RequestInit);
    const comeco = Date.now();
    const resposta = await enviarVideoRota(pedidoLento, { params: Promise.resolve({ id: String(inicio.publicacaoId) }) });
    expect(resposta.status).toBe(200);
    expect(Date.now() - comeco).toBeGreaterThanOrEqual(megas * 30);
    expect(dasChamadas("envio")[0].bytes).toBe(tamanho);
    expect((await linha(inicio.publicacaoId)).estado).toBe("processando");
  });

  it("sem sessão 401; ver como 403; barrada 402; id que não é número 404; nada vai à Meta", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    chamadas.length = 0;
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(5)))).status).toBe(401);
    entrar("pi-dono-a");
    estado.verComo = true;
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(5)))).status).toBe(403);
    estado.verComo = false;
    estado.barrada = true;
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(5)))).status).toBe(402);
    estado.barrada = false;
    expect((await enviarVideoRota(...pedido("1e3", new Uint8Array(5)))).status).toBe(404);
    expect(chamadas).toHaveLength(0);
    expect((await linha(inicio.publicacaoId)).estado).toBe("enviando");
  });

  it("membro 403; outra marca 404; o vídeo de outro tamanho que o declarado 400", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    chamadas.length = 0;
    entrar("pi-membro-a");
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(5)))).status).toBe(403);
    entrar("pi-dono-b");
    expect((await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(5)))).status).toBe(404);
    expect(chamadas).toHaveLength(0);
    entrar("pi-dono-a");
    const curto = await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(3)));
    expect(curto.status).toBe(400);
    expect((await curto.json()).erro).toBe(fraseDeFalha("envio-interrompido"));
    expect(dasChamadas("envio")).toHaveLength(0);
  });

  it("a Meta recusa o vídeo: 502 com a frase em língua de gente, sem código técnico", async () => {
    const inicio = await iniciarPublicacao(entradaDeIniciar({ roteiroId: roteiroA }), deps());
    if (!inicio.ok) throw new Error("nao iniciou");
    instalarMeta({ erroNoEnvio: { code: 352, retriable: false } });
    entrar("pi-dono-a");
    const resposta = await enviarVideoRota(...pedido(inicio.publicacaoId, new Uint8Array(5)));
    expect(resposta.status).toBe(502);
    const corpo = (await resposta.json()) as { erro: string };
    expect(corpo.erro).toBe(fraseDeFalha("nao-preparou", "reels"));
    for (const token of TOKENS) expect(JSON.stringify(corpo)).not.toContain(token);
  });
});
