/**
 * E47 PR 2, subir, guardar e transcrever o vídeo da pessoa, contra o Postgres local, o ffmpeg e o ffprobe de verdade (vídeos sintéticos gerados aqui, sem nenhum vídeo de ninguém) e uma Groq
 * FALSA (um servidor HTTP local: nenhum teste fala com a Groq de verdade). Prova: o fluxo feliz (abrir a edição, subir o vídeo, o arquivo no volume, a transcrição com palavras e tempos, o
 * prompt de nomes do briefing, o custo em `custos_externos` e em `consumo_api`), o que o `ffprobe` recusa (4K, longo, curto, sem som, arquivo que não é vídeo) com a frase certa e sem deixar
 * arquivo, a cota de 30 por mês (e a virada do mês, e dois pedidos ao mesmo tempo), as travas das rotas (sessão, "ver como", cobrança, tamanho exato, um envio por vez), o isolamento entre
 * marcas, a Groq que falha e a que não ouve fala, e a limpeza (48 horas, 7 dias, sem arquivo órfão).
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat, utimes, writeFile, readFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string; name: string }; session: { userId: string }; verComo: null | object },
  verComo: false,
  barrada: false,
  logs: [] as unknown[][],
  enfileirados: [] as { fila: string; dados: unknown }[],
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
    exigirAssinaturaValida: async () => undefined,
    recusaDaCobranca: async () => (estado.barrada ? NextResponse.json({ erro: "assinatura" }, { status: 402 }) : null),
  };
});
vi.mock("@/lib/log", () => {
  const guardar = (...args: unknown[]) => void estado.logs.push(args);
  return { logger: { info: guardar, warn: guardar, error: guardar, debug: guardar, trace: guardar, fatal: guardar } };
});
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return {
    ...original,
    garantirBossPronto: async () => undefined,
    boss: () => ({ send: async (fila: string, dados: unknown) => void estado.enfileirados.push({ fila, dados }) }),
  };
});

import { GUARDA_DO_BRUTO_MS, LIMITES_DA_EDICAO } from "@/config/edicao";
import { db } from "@/db";
import { briefings, clientes, consumoApi, custosExternos, edicoes, membrosMarca, nichos, roteiros, user } from "@/db/schema";
import { nomeRelativoDoBruto, nomeRelativoDoEditado } from "@/edicao/arquivos";
import { rodarLimparEdicoes } from "@/jobs/limpar-edicoes";
import { rodarTranscreverEdicao } from "@/jobs/transcrever-edicao";
import { config } from "@/lib/config";
import { iniciarEdicao, receberVideoDaEdicao, usoDoMes } from "@/servicos/edicao";
import { fraseDaEdicao } from "@/textos/edicao";

import { resetarSchema } from "../../scripts/resetar-schema";

const { POST: abrirRota } = await import("@/app/api/edicao/route");
const { GET: lerRota } = await import("@/app/api/edicao/[id]/route");
const { PUT: enviarRota } = await import("@/app/api/edicao/[id]/video/route");

let pasta: string;
let volume: string;
let videos: Record<string, Buffer>;
let marcaA: number;
let marcaB: number;
let roteiroA: number;
let roteiroB: number;
let nichoId: number;
const anteriorEdicaoPasta = process.env.EDICAO_PASTA;
const anteriorGroqUrl = process.env.GROQ_BASE_URL;

// ---------------------------------------------------------------------------
// Vídeos sintéticos (gerados aqui, sem voz nem imagem de ninguém)
// ---------------------------------------------------------------------------

function ffmpeg(...args: string[]): void {
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", ...args], { stdio: "pipe" });
}

const IMAGEM = (tamanho: string, taxa: number) => ["-f", "lavfi", "-i", `testsrc2=size=${tamanho}:rate=${taxa}`];
const SOM = ["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=16000"];
const CODECS = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"];

async function gerarVideos(): Promise<Record<string, Buffer>> {
  const g = (nome: string) => join(pasta, nome);
  ffmpeg(...IMAGEM("360x640", 15), ...SOM, "-t", "6", ...CODECS, g("bom.mp4"));
  ffmpeg(...IMAGEM("2160x3840", 2), ...SOM, "-t", "4", ...CODECS, g("quatro-k.mp4"));
  ffmpeg(...IMAGEM("360x640", 15), "-t", "5", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", g("mudo.mp4"));
  ffmpeg(...IMAGEM("360x640", 15), ...SOM, "-t", "1", ...CODECS, g("curto.mp4"));
  ffmpeg("-f", "lavfi", "-i", "color=size=64x64:rate=1", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "185", ...CODECS, g("longo.mp4"));
  // iPhone em pé: 640x360 gravado com a rotação de 90 graus no arquivo.
  ffmpeg(...IMAGEM("640x360", 15), ...SOM, "-t", "5", ...CODECS, g("deitado.mp4"));
  ffmpeg("-display_rotation", "90", "-i", g("deitado.mp4"), "-c", "copy", g("girado.mp4"));
  await writeFile(g("falso.mp4"), Buffer.from("isto nao e um video, so bytes soltos ".repeat(200)));
  const saida: Record<string, Buffer> = {};
  for (const nome of ["bom", "quatro-k", "mudo", "curto", "longo", "girado", "falso"]) saida[nome] = await readFile(g(`${nome}.mp4`));
  return saida;
}

// ---------------------------------------------------------------------------
// A Groq falsa
// ---------------------------------------------------------------------------

type PedidoGroq = { campos: Record<string, string>; camposRepetidos: string[]; bytes: number };
const pedidosGroq: PedidoGroq[] = [];
let respostaGroq: () => { status: number; corpo: unknown };
let servidorGroq: Server;

const RESPOSTA_BOA = {
  text: "Hoje eu vou mostrar como lavar a louça. Primeiro tire o excesso.",
  language: "Portuguese",
  duration: 6.0,
  segments: [
    { id: 0, start: 0.0, end: 3.0, text: "Hoje eu vou mostrar como lavar a louça.", no_speech_prob: 0.02 },
    { id: 1, start: 3.0, end: 6.0, text: "Primeiro tire o excesso.", no_speech_prob: 0.03 },
  ],
  words: [
    { word: "Hoje", start: 0.1, end: 0.4 },
    { word: "eu", start: 0.45, end: 0.55 },
    { word: "vou", start: 0.6, end: 0.8 },
    { word: "mostrar", start: 0.85, end: 1.3 },
    { word: "como", start: 1.4, end: 1.7 },
    { word: "lavar", start: 1.75, end: 2.1 },
    { word: "a", start: 2.15, end: 2.2 },
    { word: "louça.", start: 2.25, end: 2.8 },
    { word: "Primeiro", start: 3.2, end: 3.7 },
    { word: "tire", start: 3.8, end: 4.1 },
    { word: "o", start: 4.15, end: 4.2 },
    { word: "excesso.", start: 4.25, end: 5.0 },
  ],
};

async function subirGroqFalsa(): Promise<string> {
  servidorGroq = createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on("data", (p: Buffer) => pedacos.push(p));
    req.on("end", () => {
      const corpo = Buffer.concat(pedacos);
      const texto = corpo.toString("latin1");
      const campos: Record<string, string> = {};
      const repetidos: string[] = [];
      for (const m of texto.matchAll(/Content-Disposition: form-data; name="([^"]+)"\r\n\r\n([^\r\n]*)\r\n/g)) {
        campos[m[1]] = Buffer.from(m[2], "latin1").toString("utf8");
        repetidos.push(`${m[1]}=${campos[m[1]]}`);
      }
      pedidosGroq.push({ campos, camposRepetidos: repetidos, bytes: corpo.byteLength });
      const { status, corpo: resposta } = respostaGroq();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(resposta));
    });
  });
  await new Promise<void>((resolver) => servidorGroq.listen(0, "127.0.0.1", resolver));
  const porta = (servidorGroq.address() as { port: number }).port;
  return `http://127.0.0.1:${porta}`;
}

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

function entrar(usuarioId: string | null): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: "cliente", name: usuarioId }, session: { userId: usuarioId }, verComo: null } : null;
}

function pedidoAbrir(corpo: unknown): Request {
  return new Request("http://localhost/api/edicao", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
}

function pedidoVideo(id: number | string, bytes: Uint8Array, comprimento: number = bytes.byteLength): [Request, { params: Promise<{ id: string }> }] {
  const pedido = new Request(`http://localhost/api/edicao/${id}/video`, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(comprimento) },
    body: bytes,
    duplex: "half",
  } as RequestInit);
  return [pedido, { params: Promise.resolve({ id: String(id) }) }];
}

function pedidoLer(id: number | string): [Request, { params: Promise<{ id: string }> }] {
  return [new Request(`http://localhost/api/edicao/${id}`), { params: Promise.resolve({ id: String(id) }) }];
}

async function abrir(roteiroId: number, video: Buffer, extra: Record<string, unknown> = {}): Promise<number> {
  const r = await abrirRota(pedidoAbrir({ roteiroId, tamanhoBytes: video.byteLength, tipoDoArquivo: "video/mp4", nomeDoArquivo: "video.mp4", ...extra }));
  const corpo = (await r.json()) as { id?: number; erro?: string };
  if (r.status !== 200 || !corpo.id) throw new Error(`nao abriu: ${r.status} ${corpo.erro}`);
  return corpo.id;
}

/** Abre e sobe pelas rotas (o caminho de verdade) como o dono da marca A. */
async function abrirEEnviar(video: Buffer, roteiroId = roteiroA): Promise<number> {
  entrar("ed-dono-a");
  const id = await abrir(roteiroId, video);
  const r = await enviarRota(...pedidoVideo(id, video));
  if (r.status !== 200) throw new Error(`nao enviou: ${r.status} ${JSON.stringify(await r.json())}`);
  return id;
}

async function linha(id: number) {
  const [l] = await db().select().from(edicoes).where(eq(edicoes.id, id));
  return l;
}

async function arquivosDoVolume(): Promise<string[]> {
  const todos: string[] = [];
  for (const sub of ["bruto", "editado"]) for (const nome of await readdir(join(volume, sub)).catch(() => [])) todos.push(`${sub}/${nome}`);
  return todos.sort();
}

async function envelhecer(relativo: string, horas: number): Promise<void> {
  const caminho = join(volume, ...relativo.split("/"));
  const t = new Date(Date.now() - horas * 3_600_000);
  await utimes(caminho, t, t);
}

async function criarArquivo(relativo: string, conteudo = "x"): Promise<void> {
  const caminho = join(volume, ...relativo.split("/"));
  await mkdir(join(caminho, ".."), { recursive: true });
  await writeFile(caminho, conteudo);
}

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

async function criarRoteiro(clienteId: number): Promise<number> {
  const [r] = await db().insert(roteiros).values({ clienteId, data: "2026-10-29", tema: "tema", origem: "sugerido", objetivo: "alcance", conteudo: CONTEUDO }).returning({ id: roteiros.id });
  return r.id;
}

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "edicao-integracao-"));
  volume = join(pasta, "volume");
  process.env.EDICAO_PASTA = volume;
  videos = await gerarVideos();
  process.env.GROQ_BASE_URL = await subirGroqFalsa();
  config.transcricao.groqKey = "chave-falsa-so-do-teste";

  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "edicao-teste", nome: "Edicao teste", termos: [] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values([
    { id: "ed-dono-a", name: "Dono A", email: "ed-dono-a@exemplo.teste", role: "cliente" },
    { id: "ed-membro-a", name: "Membro A", email: "ed-membro-a@exemplo.teste", role: "cliente" },
    { id: "ed-dono-b", name: "Dono B", email: "ed-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "ed-dono-a", nome: "[teste] Marca Alfa", nichoId, perfis, cidade: "Campinas" },
      { usuarioId: "ed-dono-b", nome: "[teste] Marca Beta", nichoId, perfis },
    ])
    .returning();
  [marcaA, marcaB] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "ed-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "ed-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "ed-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
  await db().insert(briefings).values({
    clienteId: marcaA,
    completo: true,
    perfil: { fatos: { oQueVende: "detergente concentrado para louça", preco: "", clienteIdeal: "", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: ["Marca Rival"], perfisAdmirados: [] }, resumo: "", referencias: [] },
  });
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolver) => servidorGroq.close(() => resolver()));
  if (anteriorEdicaoPasta === undefined) delete process.env.EDICAO_PASTA;
  else process.env.EDICAO_PASTA = anteriorEdicaoPasta;
  if (anteriorGroqUrl === undefined) delete process.env.GROQ_BASE_URL;
  else process.env.GROQ_BASE_URL = anteriorGroqUrl;
  await rm(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  await db().delete(edicoes);
  await db().delete(custosExternos);
  await db().delete(consumoApi);
  await db().delete(roteiros);
  await rm(volume, { recursive: true, force: true });
  roteiroA = await criarRoteiro(marcaA);
  roteiroB = await criarRoteiro(marcaB);
  estado.sessao = null;
  estado.verComo = false;
  estado.barrada = false;
  estado.logs.length = 0;
  estado.enfileirados.length = 0;
  pedidosGroq.length = 0;
  respostaGroq = () => ({ status: 200, corpo: RESPOSTA_BOA });
});

afterEach(() => {
  // Nenhuma fala da pessoa nem caminho de arquivo pode ter ido parar no log.
  const tudo = JSON.stringify(estado.logs);
  expect(tudo).not.toContain("louça");
  expect(tudo).not.toContain(volume.replaceAll("\\", "\\\\"));
});

// ---------------------------------------------------------------------------
// O caminho feliz
// ---------------------------------------------------------------------------

describe("subir, guardar e transcrever", () => {
  it("abre a edição, guarda o vídeo no volume, confere e enfileira; o worker transcreve com palavras, energia e prompt de nomes", async () => {
    entrar("ed-dono-a");
    const aberta = await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: videos.bom.byteLength, tipoDoArquivo: "video/mp4", nomeDoArquivo: "video.mp4" }));
    expect(aberta.status).toBe(200);
    const { id, usadas, limite } = (await aberta.json()) as { id: number; usadas: number; limite: number };
    expect([usadas, limite]).toEqual([1, 30]);
    expect((await linha(id)).estado).toBe("subindo");

    const enviada = await enviarRota(...pedidoVideo(id, videos.bom));
    expect(enviada.status).toBe(200);
    expect(await enviada.json()).toEqual({ ok: true });

    const guardada = await linha(id);
    expect(guardada.estado).toBe("guardado");
    expect(guardada.caminhoBruto).toBe(nomeRelativoDoBruto(id));
    expect(Number(guardada.duracaoS)).toBeGreaterThan(5.5);
    expect(Number(guardada.duracaoS)).toBeLessThan(6.5);
    expect([guardada.largura, guardada.altura]).toEqual([360, 640]);
    expect(guardada.brutoExpiraEm!.getTime() - guardada.recebidaEm!.getTime()).toBe(GUARDA_DO_BRUTO_MS);
    expect((await stat(join(volume, "bruto", `ed-${id}.video`))).size).toBe(videos.bom.byteLength);
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${id}.video`]);
    expect(estado.enfileirados).toEqual([{ fila: "transcrever-edicao", dados: { edicaoId: id } }]);

    // O worker.
    const resumo = await rodarTranscreverEdicao(id);
    expect(resumo).toMatchObject({ edicaoId: id, estado: "transcrito", palavras: 12 });
    const pronta = await linha(id);
    expect(pronta.estado).toBe("transcrito");
    expect(pronta.tentativas).toBe(1);
    // E47 PR 3: a transcrição pronta enfileira a decisão da edição.
    expect(estado.enfileirados).toEqual([
      { fila: "transcrever-edicao", dados: { edicaoId: id } },
      { fila: "decidir-edicao", dados: { edicaoId: id } },
    ]);
    expect(pronta.idioma).toBe("pt");
    expect(pronta.palavras).toHaveLength(12);
    expect(pronta.palavras![0]).toEqual({ texto: "Hoje", inicio: 0.1, fim: 0.4, abreTrecho: true });
    expect(pronta.palavras![8]).toMatchObject({ texto: "Primeiro", abreTrecho: true });
    expect(pronta.palavras![1].abreTrecho).toBeUndefined();
    // A curva de energia: uma janela de 10 ms, a duração real do áudio.
    expect(Math.abs(pronta.energia!.db.length - 600)).toBeLessThanOrEqual(10);
    expect(pronta.energia!.duracao).toBeGreaterThan(5.5);
    expect(pronta.energia!.db.every((x) => Number.isFinite(x))).toBe(true);
    expect(Number(pronta.custoTranscricaoUsd)).toBeCloseTo((10 / 3600) * 0.04, 5);
    // O áudio temporário não sobra.
    expect((await readdir(tmpdir())).filter((n) => n.startsWith("edicao-") && !n.startsWith("edicao-integracao") && !n.startsWith("edicao-teste"))).toEqual([]);

    // O que a Groq (falsa) recebeu: palavras com tempo, idioma, o prompt tirado do briefing e o áudio de 16 kHz mono (WAV).
    expect(pedidosGroq).toHaveLength(1);
    const pedido = pedidosGroq[0];
    expect(pedido.camposRepetidos).toEqual(expect.arrayContaining(["timestamp_granularities[]=word", "timestamp_granularities[]=segment", "response_format=verbose_json", "language=pt"]));
    expect(pedido.campos.prompt).toContain("[teste] Marca Alfa");
    expect(pedido.campos.prompt).toContain("Campinas");
    expect(pedido.campos.prompt).toContain("detergente concentrado para louça");
    expect(pedido.campos.prompt).toContain("Marca Rival");
    expect(pedido.bytes).toBeGreaterThan(150_000); // 6 s de WAV a 16 kHz mono 16 bits = 192 KB
    expect(pedido.bytes).toBeLessThan(260_000);

    // O custo: em dólar em `custos_externos` (com a edição no detalhe) e os segundos no contador do dia em `consumo_api`.
    const custos = await db().select().from(custosExternos);
    expect(custos).toHaveLength(1);
    expect(custos[0]).toMatchObject({ fonte: "groq", unidade: "minutos", origemDoCusto: "estimado" });
    expect(custos[0].detalhe).toMatchObject({ edicaoId: id, segundos: 6 });
    const [consumo] = await db().select().from(consumoApi).where(eq(consumoApi.fonte, "groq"));
    expect(consumo.unidades).toBe(6);

    // A tela só vê o resumo.
    const vista = await (await lerRota(...pedidoLer(id))).json();
    expect(vista).toMatchObject({ id, estado: "transcrito", palavras: 12, motivo: null, uso: { usadas: 1, limite: 30 } });
    expect(JSON.stringify(vista)).not.toContain("Hoje");
    expect(JSON.stringify(vista)).not.toContain("caminho");

    // Repetir o job (a fila repete, a limpeza enfileira de novo) não transcreve outra vez nem cobra outra vez.
    expect(await rodarTranscreverEdicao(id)).toMatchObject({ pulou: "transcrito" });
    expect(pedidosGroq).toHaveLength(1);
  });

  it("vídeo gravado em pé pelo iPhone (rotação de 90 graus no arquivo) vale como a pessoa vê", async () => {
    const id = await abrirEEnviar(videos.girado);
    const l = await linha(id);
    expect(l.estado).toBe("guardado");
    expect(l.altura).toBeGreaterThan(l.largura!);
    expect([90, 270]).toContain(l.rotacao);
  });
});

// ---------------------------------------------------------------------------
// O que o ffprobe recusa
// ---------------------------------------------------------------------------

describe("vídeo recusado", () => {
  const casos: { nome: string; video: string; codigo: Parameters<typeof fraseDaEdicao>[0] }[] = [
    { nome: "4K", video: "quatro-k", codigo: "qualidade-alta" },
    { nome: "mais de 3 minutos", video: "longo", codigo: "longo" },
    { nome: "curto demais", video: "curto", codigo: "curto" },
    { nome: "sem som", video: "mudo", codigo: "sem-som" },
    { nome: "um arquivo que não é vídeo", video: "falso", codigo: "nao-abriu" },
  ];

  for (const caso of casos) {
    it(`${caso.nome}: 422 com a frase, o arquivo some, a edição falha e não conta no mês`, async () => {
      entrar("ed-dono-a");
      const video = videos[caso.video];
      const id = await abrir(roteiroA, video);
      const resposta = await enviarRota(...pedidoVideo(id, video));
      expect(resposta.status).toBe(422);
      const corpo = (await resposta.json()) as { erro: string; codigo: string };
      expect(corpo.codigo).toBe(caso.codigo);
      expect(corpo.erro).toBe(fraseDaEdicao(caso.codigo));
      const l = await linha(id);
      expect(l.estado).toBe("falhou");
      expect(l.motivo).toBe(fraseDaEdicao(caso.codigo));
      expect(l.caminhoBruto).toBeNull();
      expect(await arquivosDoVolume()).toEqual([]);
      expect(estado.enfileirados).toEqual([]);
      expect((await usoDoMes(marcaA)).usadas).toBe(0);
    });
  }

  it("a frase do 4K diz o que fazer em língua de gente", () => {
    const frase = fraseDaEdicao("qualidade-alta");
    expect(frase).toContain("HD");
    expect(frase).toContain("1080p");
    expect(frase).not.toMatch(/codec|resolu[cç][aã]o|bitrate/i);
  });
});

// ---------------------------------------------------------------------------
// As travas das rotas
// ---------------------------------------------------------------------------

describe("travas das rotas", () => {
  it("sem sessão 401; ver como 403 (abrir e enviar), mas pode olhar; barrada 402; id que não é número 404; nada é gravado", async () => {
    entrar("ed-dono-a");
    const id = await abrir(roteiroA, videos.bom);
    entrar(null);
    expect((await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 5, tipoDoArquivo: "video/mp4" }))).status).toBe(401);
    expect((await enviarRota(...pedidoVideo(id, videos.bom))).status).toBe(401);
    expect((await lerRota(...pedidoLer(id))).status).toBe(401);

    entrar("ed-dono-a");
    estado.verComo = true;
    expect((await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 5, tipoDoArquivo: "video/mp4" }))).status).toBe(403);
    expect((await enviarRota(...pedidoVideo(id, videos.bom))).status).toBe(403);
    // O "ver como" só olha: a vista é a da pessoa.
    const olhada = await lerRota(...pedidoLer(id));
    expect(olhada.status).toBe(200);
    expect(await olhada.json()).toMatchObject({ id, estado: "subindo" });
    estado.verComo = false;

    estado.barrada = true;
    expect((await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 5, tipoDoArquivo: "video/mp4" }))).status).toBe(402);
    expect((await enviarRota(...pedidoVideo(id, videos.bom))).status).toBe(402);
    expect((await lerRota(...pedidoLer(id))).status).toBe(402);
    estado.barrada = false;

    expect((await enviarRota(...pedidoVideo("1e3", videos.bom))).status).toBe(404);
    expect((await enviarRota(...pedidoVideo("abc", videos.bom))).status).toBe(404);
    expect(await arquivosDoVolume()).toEqual([]);
    const l = await linha(id);
    expect(l.estado).toBe("subindo");
    expect((await db().select().from(edicoes)).length).toBe(1);
  });

  it("o tamanho tem de bater byte a byte com o declarado: Content-Length diferente, corpo maior ou menor falham, e nada fica no disco", async () => {
    entrar("ed-dono-a");
    const a = await abrir(roteiroA, videos.bom);
    const r1 = await enviarRota(...pedidoVideo(a, videos.bom, videos.bom.byteLength + 7));
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { codigo: string }).codigo).toBe("envio-interrompido");
    expect((await linha(a)).estado).toBe("falhou");

    for (const [diferenca, nome] of [
      [10, "maior"],
      [-10, "menor"],
    ] as const) {
      const b = await abrir(roteiroA, videos.bom);
      const corpo = diferenca > 0 ? Buffer.concat([videos.bom, Buffer.alloc(diferenca)]) : videos.bom.subarray(0, videos.bom.byteLength + diferenca);
      // Content-Length igual ao declarado, mas o corpo que chega é maior ou menor.
      const pedido = new Request(`http://localhost/api/edicao/${b}/video`, {
        method: "PUT",
        headers: { "content-length": String(videos.bom.byteLength) },
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(corpo));
            c.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
      const r = await enviarRota(pedido, { params: Promise.resolve({ id: String(b) }) });
      expect(r.status, nome).toBe(400);
      expect((await linha(b)).estado, nome).toBe("falhou");
    }
    expect(await arquivosDoVolume()).toEqual([]);
    expect(estado.enfileirados).toEqual([]);
  });

  it("recusa o arquivo grande demais, o tipo que não é vídeo, o vazio e o roteiro que não existe, já ao abrir", async () => {
    entrar("ed-dono-a");
    const abre = async (corpo: Record<string, unknown>) => {
      const r = await abrirRota(pedidoAbrir(corpo));
      return { status: r.status, corpo: (await r.json()) as { codigo: string; erro: string } };
    };
    expect(await abre({ roteiroId: roteiroA, tamanhoBytes: LIMITES_DA_EDICAO.bytesMax + 1, tipoDoArquivo: "video/mp4" })).toMatchObject({ status: 400, corpo: { codigo: "arquivo-grande" } });
    expect(await abre({ roteiroId: roteiroA, tamanhoBytes: 100, tipoDoArquivo: "image/png", nomeDoArquivo: "foto.png" })).toMatchObject({ status: 400, corpo: { codigo: "arquivo-tipo" } });
    expect(await abre({ roteiroId: roteiroA, tamanhoBytes: 0, tipoDoArquivo: "video/mp4" })).toMatchObject({ status: 400, corpo: { codigo: "arquivo-vazio" } });
    expect(await abre({ roteiroId: 999999, tamanhoBytes: 100, tipoDoArquivo: "video/mp4" })).toMatchObject({ status: 404, corpo: { codigo: "sem-roteiro" } });
    expect(await abre({ roteiroId: "abc", tamanhoBytes: 100, tipoDoArquivo: "video/mp4" })).toMatchObject({ status: 404, corpo: { codigo: "sem-roteiro" } });
    expect((await abrirRota(new Request("http://localhost/api/edicao", { method: "POST", body: "isto nao e json" }))).status).toBe(400);
    expect(await db().select().from(edicoes)).toHaveLength(0);
  });

  it("uma edição por roteiro em andamento; depois que termina, outra pode começar", async () => {
    entrar("ed-dono-a");
    await abrir(roteiroA, videos.bom);
    const segunda = await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }));
    expect(segunda.status).toBe(409);
    expect(((await segunda.json()) as { codigo: string }).codigo).toBe("em-andamento");
  });

  it("um envio por edição por vez: o segundo recebe 409 sem tocar em nada, e o primeiro termina bem", async () => {
    entrar("ed-dono-a");
    const id = await abrir(roteiroA, videos.bom);
    let liberar!: () => void;
    const portao = new Promise<void>((resolver) => (liberar = resolver));
    const lento = new ReadableStream<Uint8Array>({
      async pull(controle) {
        await portao;
        controle.enqueue(new Uint8Array(videos.bom));
        controle.close();
      },
    });
    const primeiro = receberVideoDaEdicao({ clienteId: marcaA, edicaoId: id, corpo: lento, tamanhoDoPedido: videos.bom.byteLength });
    await new Promise((r) => setTimeout(r, 300));
    const segundo = await receberVideoDaEdicao({ clienteId: marcaA, edicaoId: id, corpo: new ReadableStream({ start: (c) => c.close() }), tamanhoDoPedido: 0 });
    expect(segundo).toMatchObject({ ok: false, codigo: "envio-em-curso", status: 409 });
    expect((await linha(id)).estado).toBe("subindo");
    liberar();
    expect(await primeiro).toEqual({ ok: true });
    expect((await linha(id)).estado).toBe("guardado");
  });
});

// ---------------------------------------------------------------------------
// A cota do mês
// ---------------------------------------------------------------------------

describe("cota de 30 edições por mês", () => {
  async function encher(clienteId: number, roteiroId: number, quantas: number, extra: Partial<typeof edicoes.$inferInsert> = {}): Promise<void> {
    await db()
      .insert(edicoes)
      .values(Array.from({ length: quantas }, () => ({ clienteId, roteiroId, tamanhoBytes: 10, tipoDoArquivo: "video/mp4", estado: "transcrito" as const, ...extra })));
  }

  it("na 31ª o pedido volta 429 com a frase; só quem falhou antes de gastar não conta", async () => {
    entrar("ed-dono-a");
    await encher(marcaA, roteiroA, 29);
    await encher(marcaA, roteiroA, 5, { estado: "falhou" }); // não contam
    const trinta = await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }));
    expect(trinta.status).toBe(200);
    expect(await trinta.json()).toMatchObject({ usadas: 30, limite: 30 });
    // Fecha a edição aberta para o roteiro ficar livre de novo e tenta a 31ª.
    await db().update(edicoes).set({ estado: "transcrito" }).where(and(eq(edicoes.estado, "subindo")));
    const trintaEUma = await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }));
    expect(trintaEUma.status).toBe(429);
    const corpo = (await trintaEUma.json()) as { erro: string; codigo: string };
    expect(corpo).toEqual({ erro: fraseDaEdicao("limite-do-mes"), codigo: "limite-do-mes" });
    expect(corpo.erro).toContain("30 edições");
    expect(await db().select().from(edicoes)).toHaveLength(29 + 5 + 1);
  });

  it("o mês vira à meia-noite de Brasília: no dia 31 às 23:59 ainda pesa, no dia 1 já não", async () => {
    await encher(marcaA, roteiroA, 30, { criadaEm: new Date("2026-10-31T20:00:00Z") });
    const noUltimoMinuto = await iniciarEdicao({ usuarioId: "ed-dono-a", clienteId: marcaA, roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }, { agora: () => new Date("2026-11-01T02:59:00Z") });
    expect(noUltimoMinuto).toMatchObject({ ok: false, codigo: "limite-do-mes" });
    const noPrimeiro = await iniciarEdicao({ usuarioId: "ed-dono-a", clienteId: marcaA, roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }, { agora: () => new Date("2026-11-01T03:00:00Z") });
    expect(noPrimeiro).toMatchObject({ ok: true, usadas: 1 });
  });

  it("dois pedidos ao mesmo tempo não passam do teto", async () => {
    await encher(marcaA, roteiroA, 27);
    // Roteiros diferentes, para a regra de um por roteiro não decidir por eles.
    const roteiros6 = await Promise.all(Array.from({ length: 6 }, () => criarRoteiro(marcaA)));
    const resultados = await Promise.all(roteiros6.map((roteiroId) => iniciarEdicao({ usuarioId: "ed-dono-a", clienteId: marcaA, roteiroId, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" })));
    expect(resultados.filter((r) => r.ok)).toHaveLength(3);
    expect(resultados.filter((r) => !r.ok && r.codigo === "limite-do-mes")).toHaveLength(3);
    expect((await usoDoMes(marcaA)).usadas).toBe(30);
  });

  it("a cota é por marca: o que uma gasta a outra não perde", async () => {
    await encher(marcaA, roteiroA, 30);
    expect((await usoDoMes(marcaB)).usadas).toBe(0);
    entrar("ed-dono-b");
    const r = await abrirRota(pedidoAbrir({ roteiroId: roteiroB, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }));
    expect(r.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Isolamento entre marcas e membros
// ---------------------------------------------------------------------------

describe("isolamento entre marcas", () => {
  it("a marca B não vê, não envia e não abre edição com o roteiro da marca A; o que A tem fica intacto", async () => {
    entrar("ed-dono-a");
    const idA = await abrir(roteiroA, videos.bom);

    entrar("ed-dono-b");
    // Ler: como se não existisse.
    const lida = await lerRota(...pedidoLer(idA));
    expect(lida.status).toBe(404);
    expect(((await lida.json()) as { codigo: string }).codigo).toBe("nao-achou");
    // Enviar o vídeo para a edição de A: 404, e nada é gravado.
    const enviada = await enviarRota(...pedidoVideo(idA, videos.bom));
    expect(enviada.status).toBe(404);
    expect(await arquivosDoVolume()).toEqual([]);
    expect((await linha(idA)).estado).toBe("subindo");
    // Abrir com o roteiro de A: o roteiro "não existe" para B.
    const aberta = await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }));
    expect(aberta.status).toBe(404);
    expect(((await aberta.json()) as { codigo: string }).codigo).toBe("sem-roteiro");

    // B tem a edição dela, e A não a enxerga.
    const idB = await abrir(roteiroB, videos.bom);
    expect((await enviarRota(...pedidoVideo(idB, videos.bom))).status).toBe(200);
    entrar("ed-dono-a");
    expect((await lerRota(...pedidoLer(idB))).status).toBe(404);
    expect((await enviarRota(...pedidoVideo(idB, videos.bom))).status).toBe(404);
    expect((await usoDoMes(marcaA)).usadas).toBe(1);
    expect((await usoDoMes(marcaB)).usadas).toBe(1);
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${idB}.video`]);
  });

  it("o serviço também filtra pela marca recebida, não pela sessão", async () => {
    entrar("ed-dono-a");
    const id = await abrir(roteiroA, videos.bom);
    const r = await receberVideoDaEdicao({ clienteId: marcaB, edicaoId: id, corpo: new ReadableStream({ start: (c) => c.close() }), tamanhoDoPedido: 0 });
    expect(r).toMatchObject({ ok: false, codigo: "nao-achou", status: 404 });
    expect((await linha(id)).estado).toBe("subindo");
  });

  it("o membro da marca também edita (a edição é da marca, não só do dono)", async () => {
    entrar("ed-membro-a");
    const id = await abrir(roteiroA, videos.bom);
    expect((await enviarRota(...pedidoVideo(id, videos.bom))).status).toBe(200);
  });

  it("o job de uma edição não mexe na de outra marca", async () => {
    const idA = await abrirEEnviar(videos.bom);
    entrar("ed-dono-b");
    const idB = await abrir(roteiroB, videos.bom);
    await rodarTranscreverEdicao(idA);
    expect((await linha(idA)).estado).toBe("transcrito");
    expect((await linha(idB)).estado).toBe("subindo");
    expect((await linha(idB)).palavras).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A Groq que falha, a que não ouve fala
// ---------------------------------------------------------------------------

describe("transcrição que não dá certo", () => {
  it("a Groq recusa: volta a guardado e relança nas duas primeiras vezes; na terceira a edição falha, com a frase, e o vídeo sai do disco", async () => {
    respostaGroq = () => ({ status: 400, corpo: { error: { message: "recusado pela Groq falsa" } } });
    const id = await abrirEEnviar(videos.bom);

    await expect(rodarTranscreverEdicao(id)).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "guardado", tentativas: 1 });
    await expect(rodarTranscreverEdicao(id)).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "guardado", tentativas: 2 });
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${id}.video`]);

    const ultimo = await rodarTranscreverEdicao(id);
    expect(ultimo).toMatchObject({ estado: "falhou", motivo: "groq", tentativas: 3 });
    const l = await linha(id);
    expect(l.estado).toBe("falhou");
    expect(l.motivo).toBe(fraseDaEdicao("nao-entendeu"));
    expect(l.caminhoBruto).toBeNull();
    expect(await arquivosDoVolume()).toEqual([]);
    expect(pedidosGroq).toHaveLength(3);
    // Falhou por culpa nossa: não pesa nas 30 do mês.
    expect((await usoDoMes(marcaA)).usadas).toBe(0);
  });

  it("a Groq volta na segunda tentativa: a edição fica transcrita", async () => {
    let chamada = 0;
    respostaGroq = () => (++chamada === 1 ? { status: 400, corpo: { error: { message: "x" } } } : { status: 200, corpo: RESPOSTA_BOA });
    const id = await abrirEEnviar(videos.bom);
    await expect(rodarTranscreverEdicao(id)).rejects.toThrow();
    expect(await rodarTranscreverEdicao(id)).toMatchObject({ estado: "transcrito" });
    expect(await linha(id)).toMatchObject({ estado: "transcrito", tentativas: 2 });
  });

  it("sem fala no áudio: falha na hora, sem repetir, com a frase; o custo fica registrado e o vídeo sai do disco", async () => {
    respostaGroq = () => ({
      status: 200,
      corpo: { text: "Thank you.", language: "English", duration: 6, segments: [{ start: 0, end: 6, no_speech_prob: 0.9 }], words: [{ word: "Thank", start: 0, end: 1 }] },
    });
    const id = await abrirEEnviar(videos.bom);
    expect(await rodarTranscreverEdicao(id)).toMatchObject({ estado: "falhou", motivo: "sem-fala" });
    const l = await linha(id);
    expect(l.motivo).toBe(fraseDaEdicao("sem-fala"));
    expect(l.palavras).toBeNull();
    expect(Number(l.custoTranscricaoUsd)).toBeGreaterThan(0);
    expect(await arquivosDoVolume()).toEqual([]);
    expect((await db().select().from(custosExternos)).length).toBe(1);
  });

  it("o vídeo sumiu do volume antes do worker: falha com a frase", async () => {
    const id = await abrirEEnviar(videos.bom);
    await rm(join(volume, "bruto", `ed-${id}.video`));
    expect(await rodarTranscreverEdicao(id)).toMatchObject({ estado: "falhou", motivo: "sumiu" });
    expect((await linha(id)).motivo).toBe(fraseDaEdicao("sumiu"));
    expect(pedidosGroq).toHaveLength(0);
  });

  it("edição inexistente ou ainda subindo: o job só pula", async () => {
    expect(await rodarTranscreverEdicao(987654)).toEqual({ edicaoId: 987654, pulou: "inexistente" });
    entrar("ed-dono-a");
    const id = await abrir(roteiroA, videos.bom);
    expect(await rodarTranscreverEdicao(id)).toEqual({ edicaoId: id, pulou: "subindo" });
    expect(pedidosGroq).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A limpeza
// ---------------------------------------------------------------------------

describe("limpeza (bruto em 48 horas, editado em 7 dias, sem arquivo órfão)", () => {
  it("o bruto some no prazo, com as palavras e a energia; a linha fica; a edição expira", async () => {
    const id = await abrirEEnviar(videos.bom);
    await rodarTranscreverEdicao(id);
    const recebida = (await linha(id)).recebidaEm!;

    // Antes das 48 horas: nada sai.
    const antes = await rodarLimparEdicoes({ agora: () => new Date(recebida.getTime() + GUARDA_DO_BRUTO_MS - 60_000) });
    expect(antes).toMatchObject({ brutosApagados: 0, expiradas: 0 });
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${id}.video`]);
    expect((await linha(id)).palavras).toHaveLength(12);

    // Passou: sai.
    const depois = await rodarLimparEdicoes({ agora: () => new Date(recebida.getTime() + GUARDA_DO_BRUTO_MS + 60_000) });
    expect(depois).toMatchObject({ brutosApagados: 1, expiradas: 1 });
    expect(await arquivosDoVolume()).toEqual([]);
    const l = await linha(id);
    expect(l).toMatchObject({ estado: "expirada", caminhoBruto: null, palavras: null, energia: null });
    expect(l.brutoApagadoEm).not.toBeNull();
    // A linha continua contando no mês (a transcrição e a IA já foram gastas).
    expect((await usoDoMes(marcaA)).usadas).toBe(1);
    // Rodar de novo não faz nada.
    expect(await rodarLimparEdicoes({ agora: () => new Date(recebida.getTime() + GUARDA_DO_BRUTO_MS + 120_000) })).toMatchObject({ brutosApagados: 0, expiradas: 0 });
  });

  it("o editado some em 7 dias e o bruto, em 48 horas, cada um no seu prazo; a edição só expira quando nenhum sobra", async () => {
    const id = await abrirEEnviar(videos.bom);
    const recebida = (await linha(id)).recebidaEm!;
    const editado = nomeRelativoDoEditado(id);
    await criarArquivo(editado, "video editado");
    const prontoEm = new Date(recebida.getTime() + 3_600_000);
    await db()
      .update(edicoes)
      .set({ estado: "transcrito", caminhoEditado: editado, editadoExpiraEm: new Date(prontoEm.getTime() + 7 * 24 * 3_600_000) })
      .where(eq(edicoes.id, id));

    // Passadas 49 horas: o bruto saiu, o editado fica, a edição não expira.
    const emDoisDias = new Date(recebida.getTime() + 49 * 3_600_000);
    expect(await rodarLimparEdicoes({ agora: () => emDoisDias })).toMatchObject({ brutosApagados: 1, editadosApagados: 0, expiradas: 0 });
    expect(await arquivosDoVolume()).toEqual([editado]);
    expect((await linha(id)).estado).toBe("transcrito");

    // Passados 7 dias do editado: sai também, e a edição expira.
    const emOitoDias = new Date(prontoEm.getTime() + 7 * 24 * 3_600_000 + 60_000);
    expect(await rodarLimparEdicoes({ agora: () => emOitoDias })).toMatchObject({ editadosApagados: 1, expiradas: 1 });
    expect(await arquivosDoVolume()).toEqual([]);
    expect(await linha(id)).toMatchObject({ estado: "expirada", caminhoEditado: null });
  });

  it("nunca sobra arquivo órfão: sem linha, com a linha já dada como apagada, parte de envio morto; o que tem dono e o que é recente ficam", async () => {
    const id = await abrirEEnviar(videos.bom); // tem dono
    await criarArquivo("bruto/ed-777777.video"); // linha nunca existiu
    await criarArquivo("editado/ed-777777.mp4"); // idem
    const outra = await abrirEEnviar(videos.bom, await criarRoteiro(marcaA));
    await db().update(edicoes).set({ caminhoBruto: null, brutoApagadoEm: new Date() }).where(eq(edicoes.id, outra)); // já dado como apagado, mas o arquivo ficou
    await criarArquivo("bruto/ed-888888.deadbeef0011.parte"); // envio que morreu
    await criarArquivo("bruto/ed-999999.video"); // chegou agora: ainda pode estar sendo registrado
    await criarArquivo("bruto/leia-me.txt"); // não é nosso
    for (const velho of ["bruto/ed-777777.video", "editado/ed-777777.mp4", `bruto/ed-${outra}.video`]) await envelhecer(velho, 3);
    await envelhecer("bruto/ed-888888.deadbeef0011.parte", 5);
    await envelhecer("bruto/leia-me.txt", 500);

    const r = await rodarLimparEdicoes();
    expect(r).toMatchObject({ arquivosSemDono: 3, partesVelhas: 1 });
    expect(await arquivosDoVolume()).toEqual(["bruto/ed-999999.video", `bruto/ed-${id}.video`, "bruto/leia-me.txt"].sort());

    // E a propriedade geral: todo arquivo do volume com nome nosso e velho tem uma linha viva que aponta para ele.
    const vivos = new Set((await db().select({ b: edicoes.caminhoBruto, e: edicoes.caminhoEditado }).from(edicoes)).flatMap((l) => [l.b, l.e]).filter(Boolean));
    expect(vivos.has(`bruto/ed-${id}.video`)).toBe(true);
  });

  it("o envio que parou vira falha; a transcrição que parou no meio volta à fila (ou desiste na terceira); a que a fila esqueceu é enfileirada de novo", async () => {
    const agora = new Date("2026-10-29T12:00:00Z");
    const antes = (minutos: number) => new Date(agora.getTime() - minutos * 60_000);
    const base = { clienteId: marcaA, roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" };
    const [subindo, subindoRecente, transcrevendo, transcrevendoTresVezes, esquecida, esquecidaDemais] = await db()
      .insert(edicoes)
      .values([
        { ...base, estado: "subindo", atualizadaEm: antes(50) },
        { ...base, estado: "subindo", atualizadaEm: antes(5) },
        { ...base, estado: "transcrevendo", tentativas: 1, atualizadaEm: antes(40) },
        { ...base, estado: "transcrevendo", tentativas: 3, atualizadaEm: antes(40) },
        { ...base, estado: "guardado", tentativas: 0, atualizadaEm: antes(15) },
        { ...base, estado: "guardado", tentativas: 3, atualizadaEm: antes(15) },
      ])
      .returning();
    const enfileiradas: number[] = [];
    const r = await rodarLimparEdicoes({ agora: () => agora, enfileirar: async (edicaoId) => void enfileiradas.push(edicaoId) });
    expect(r).toMatchObject({ enviosParados: 1, transcricoesDevolvidas: 1, transcricoesDesistidas: 1 });
    expect((await linha(subindo.id)).estado).toBe("falhou");
    expect((await linha(subindo.id)).motivo).toBe(fraseDaEdicao("envio-parado"));
    expect((await linha(subindoRecente.id)).estado).toBe("subindo");
    expect((await linha(transcrevendo.id)).estado).toBe("guardado");
    expect(await linha(transcrevendoTresVezes.id)).toMatchObject({ estado: "falhou", motivo: fraseDaEdicao("demorou") });
    // A que voltou a `guardado` agora está parada há pouco; só a esquecida (guardado há 15 minutos, com tentativas sobrando) é enfileirada.
    expect(enfileiradas).toEqual([esquecida.id]);
    expect((await linha(esquecidaDemais.id)).estado).toBe("guardado");
  });

  it("um envio parado libera o roteiro: dá para abrir outra edição", async () => {
    const agora = new Date("2026-10-29T12:00:00Z");
    await db().insert(edicoes).values({ clienteId: marcaA, roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4", estado: "subindo", atualizadaEm: new Date(agora.getTime() - 50 * 60_000), criadaEm: new Date(agora.getTime() - 50 * 60_000) });
    const r = await iniciarEdicao({ usuarioId: "ed-dono-a", clienteId: marcaA, roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }, { agora: () => agora });
    expect(r).toMatchObject({ ok: true, usadas: 1 });
  });
});

describe("alarme do disco do servidor (29/10/2026)", () => {
  const limitesDeAntes = { ...config.disco };
  afterEach(() => {
    config.disco.atencaoPercentual = limitesDeAntes.atencaoPercentual;
    config.disco.criticoPercentual = limitesDeAntes.criticoPercentual;
  });

  /** Limites de 1% e 2%: qualquer disco de verdade está acima deles, então o nível é crítico sem mexer no disco. */
  function discoCritico(): void {
    config.disco.atencaoPercentual = 1;
    config.disco.criticoPercentual = 2;
  }

  it("com o disco crítico o envio do vídeo é recusado com a frase clara, nada é gravado e a limpeza é pedida na hora", async () => {
    entrar("ed-dono-a");
    const id = await abrir(roteiroA, videos.bom);
    discoCritico();

    const r = await enviarRota(...pedidoVideo(id, videos.bom));

    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("300");
    expect(await r.json()).toEqual({ erro: "O envio de vídeos está pausado por alguns minutos. Tente de novo mais tarde.", codigo: "disco-cheio" });
    expect(await arquivosDoVolume()).toEqual([]);
    // A edição segue aberta: quando o disco voltar, o mesmo envio funciona.
    expect((await linha(id)).estado).toBe("subindo");
    expect(estado.enfileirados.map((e) => e.fila)).toContain("limpar-edicoes");
    expect(estado.enfileirados.map((e) => e.fila)).not.toContain("transcrever-edicao");
  });

  it("quando o disco volta ao normal o mesmo envio passa e a transcrição entra na fila", async () => {
    entrar("ed-dono-a");
    const id = await abrir(roteiroA, videos.bom);
    discoCritico();
    expect((await enviarRota(...pedidoVideo(id, videos.bom))).status).toBe(503);

    config.disco.atencaoPercentual = limitesDeAntes.atencaoPercentual;
    config.disco.criticoPercentual = limitesDeAntes.criticoPercentual;
    const r = await enviarRota(...pedidoVideo(id, videos.bom));

    expect(r.status).toBe(200);
    expect((await linha(id)).estado).toBe("guardado");
    expect(estado.enfileirados.map((e) => e.fila)).toContain("transcrever-edicao");
  });

  it("só o envio para editar pausa: abrir a edição e ler o estado dela continuam funcionando", async () => {
    entrar("ed-dono-a");
    discoCritico();
    const id = await abrir(roteiroA, videos.bom);
    expect((await lerRota(...pedidoLer(id))).status).toBe(200);
  });
});
