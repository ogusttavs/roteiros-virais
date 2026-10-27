/**
 * E19 PR 1: a curva do Instagram lê PRIMEIRO pela conta que a própria marca ligou (`contas_conectadas`), depois pelo usuário do sistema (V8), depois pelo Apify. A Graph API é o
 * `fetch` simulado; o Apify é de mentira (mesmo molde de `curva-cliente.test.ts`). O ponto central é o ISOLAMENTO: o acesso de uma marca só lê a conta dela, nunca a de outra, e o
 * erro do acesso de uma marca não derruba a leitura das outras.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      coleta: { ...original.config.coleta, metaAtivo: true, metaIgId: "sistema-ig", metaToken: "EAA-TOKEN-DO-SISTEMA" },
      metaConexao: { ...original.config.metaConexao, appSecret: "segredo-do-app-da-suite", tokenChave: Buffer.alloc(32, 13).toString("base64"), ativa: true, viaFacebookLigada: true },
    },
  };
});

const actorCall = vi.fn();
const datasetListItems = vi.fn();
vi.mock("apify-client", () => ({
  ApifyClient: vi.fn().mockImplementation(function ApifyClientFalso(this: { actor: () => { call: typeof actorCall }; dataset: () => { listItems: typeof datasetListItems } }) {
    this.actor = () => ({ call: actorCall });
    this.dataset = () => ({ listItems: datasetListItems });
  }),
}));

import { db, getPool } from "@/db";
import { clientes, configuracaoAdmin, consumoApi, contasConectadas, metricasVideoCliente, user, videosCliente } from "@/db/schema";
import { rodarCurvaCliente } from "@/jobs/curva-cliente";
import { cifrarToken, contextoDoToken } from "@/lib/meta-token";
import { textosLigacao } from "@/textos/conta-conectada";

import { resetarSchema } from "../../scripts/resetar-schema";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SISTEMA = "EAA-TOKEN-DO-SISTEMA";
const agora = new Date("2026-10-22T12:00:00Z");
const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);

type ChamadaMeta = { caminho: string; token: string | null; proof: string | null };
const chamadas: ChamadaMeta[] = [];
/** Quem responde o quê: a chave é `<igId ou mediaId>`; o valor diz com que token a Meta aceita e o que devolve. */
type ContaSimulada = { aceita: string; midias: { id: string; permalink: string; views: number }[]; erro?: { code: number } };
const contas = new Map<string, ContaSimulada>();

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function midiaDe(m: { id: string; permalink: string; views: number }) {
  return { id: m.id, permalink: m.permalink, media_type: "VIDEO", media_product_type: "REELS", total_views_count: m.views, like_count: 10, comments_count: 2 };
}

function instalarGraph(): void {
  mockFetch.mockImplementation(async (entrada: URL | string) => {
    const url = new URL(String(entrada));
    const token = url.searchParams.get("access_token");
    const caminho = url.pathname.replace("/v26.0/", "");
    chamadas.push({ caminho, token, proof: url.searchParams.get("appsecret_proof") });
    const [dono, resto] = caminho.split("/");
    // `<igId>/media` lista; `<mediaId>` le uma midia.
    const conta = resto === "media" ? contas.get(dono) : [...contas.values()].find((c) => c.midias.some((m) => m.id === dono));
    if (!conta) return json({ error: { message: "Unsupported get request", code: 100 } }, 400);
    if (conta.erro) return json({ error: { message: "erro simulado", code: conta.erro.code } }, 400);
    if (token !== conta.aceita) return json({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400);
    if (resto === "media") return json({ data: conta.midias.map(midiaDe) });
    return json(midiaDe(conta.midias.find((m) => m.id === dono)!));
  });
}

const idsUsuarios: string[] = [];

async function criarMarca(usuarioId: string, opts: { metaIgId?: string | null } = {}): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${usuarioId}`, email: `${usuarioId}@curva-ligada.teste` });
  idsUsuarios.push(usuarioId);
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${usuarioId}`, metaIgId: opts.metaIgId ?? null, perfis: { instagram: null, tiktok: null, youtube: null } }).returning();
  return marca.id;
}

async function ligar(clienteId: number, igId: string, token: string, extra: Partial<typeof contasConectadas.$inferInsert> = {}) {
  const [linha] = await db()
    .insert(contasConectadas)
    .values({
      clienteId,
      plataforma: "instagram",
      contaId: igId,
      nome: igId,
      metaUsuarioId: `meta-${clienteId}`,
      estado: "ativa",
      tokenCifrado: cifrarToken(token, contextoDoToken(clienteId, "instagram", igId)),
      tokenExpiraEm: new Date("2027-01-01T00:00:00Z"),
      ...extra,
    })
    .returning();
  return linha;
}

async function postar(clienteId: number, codigo: string, extra: Partial<typeof videosCliente.$inferInsert> = {}) {
  const [video] = await db().insert(videosCliente).values({ clienteId, plataforma: "instagram", url: `https://www.instagram.com/reel/${codigo}/`, idExterno: codigo, postadoEm, ...extra }).returning();
  return video;
}

const permalink = (codigo: string) => `https://www.instagram.com/reel/${codigo}/`;

async function medidaDe(videoId: number) {
  const [m] = await db().select().from(metricasVideoCliente).where(eq(metricasVideoCliente.videoClienteId, videoId));
  return m;
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  mockFetch.mockReset();
  chamadas.length = 0;
  contas.clear();
  actorCall.mockReset().mockResolvedValue({ defaultDatasetId: "ds1" });
  datasetListItems.mockReset().mockResolvedValue({ items: [] });
  instalarGraph();
});

afterEach(async () => {
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(contasConectadas);
  await db().delete(consumoApi);
  await db().delete(configuracaoAdmin);
  if (idsUsuarios.length > 0) {
    for (const id of idsUsuarios) await db().delete(user).where(eq(user.id, id));
    idsUsuarios.length = 0;
  }
});

describe("a curva lê pela conta que a marca ligou", () => {
  it("duas marcas ligadas: cada uma e lida SO com o proprio acesso e so na propria conta; nenhum token cruza; o do sistema nem e usado", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    await ligar(a, "ig-a", "EAA-A");
    await ligar(b, "ig-b", "EAA-B");
    contas.set("ig-a", { aceita: "EAA-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1111 }] });
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 2222 }] });
    const videoA = await postar(a, "CodigoA");
    const videoB = await postar(b, "CodigoB");

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramMeta: 2, medidosInstagramContaLigada: 2, medidosInstagramApify: 0 });
    expect(actorCall).not.toHaveBeenCalled();
    expect(await medidaDe(videoA.id)).toMatchObject({ views: 1111, fonte: "meta" });
    expect(await medidaDe(videoB.id)).toMatchObject({ views: 2222, fonte: "meta" });
    // A prova do isolamento: toda chamada a conta A usou o token de A, toda chamada a B usou o de B, e o do sistema nunca saiu.
    expect(chamadas.map((c) => [c.caminho, c.token]).sort()).toEqual([
      ["ig-a/media", "EAA-A"],
      ["ig-b/media", "EAA-B"],
    ]);
    expect(chamadas.every((c) => c.token !== SISTEMA)).toBe(true);
    // A prova do segredo do aplicativo vai junto (nunca o segredo em si).
    expect(chamadas.every((c) => c.proof && /^[0-9a-f]{64}$/.test(c.proof))).toBe(true);
    const [linhaA] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
    expect(linhaA.ultimaLeituraEm?.getTime()).toBe(agora.getTime());
    expect(linhaA.erro).toBeNull();
  });

  it("depois da primeira medicao le a midia direto, ainda com o acesso da propria marca", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    await ligar(a, "ig-a", "EAA-A");
    await ligar(b, "ig-b", "EAA-B");
    contas.set("ig-a", { aceita: "EAA-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 5000 }] });
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 6000 }] });
    const videoA = await postar(a, "CodigoA", { metaMediaId: "media-a" });
    const videoB = await postar(b, "CodigoB", { metaMediaId: "media-b" });

    await rodarCurvaCliente(agora);

    expect(chamadas.map((c) => [c.caminho, c.token]).sort()).toEqual([
      ["media-a", "EAA-A"],
      ["media-b", "EAA-B"],
    ]);
    expect((await medidaDe(videoA.id)).views).toBe(5000);
    expect((await medidaDe(videoB.id)).views).toBe(6000);
  });

  it("a marca SEM conta ligada (e sem meta_ig_id) nunca recebe o acesso de outra: vai ao Apify, e nenhuma chamada a Meta sai por ela", async () => {
    const a = await criarMarca("cl-a");
    const c = await criarMarca("cl-c");
    await ligar(a, "ig-a", "EAA-A");
    contas.set("ig-a", { aceita: "EAA-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1 }] });
    await postar(a, "CodigoA");
    const videoC = await postar(c, "CodigoC");
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 777, likesCount: 7, commentsCount: 1 }] });

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramContaLigada: 1, medidosInstagramApify: 1 });
    expect(await medidaDe(videoC.id)).toMatchObject({ views: 777, fonte: "apify" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ caminho: "ig-a/media", token: "EAA-A" });
  });

  it("o video de A com a conta de B ligada em outra marca: o acesso de B nao acha o video de A (cada marca olha so a propria conta)", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    // So B ligou. O video de A tem o mesmo codigo curto que existe na conta de B por coincidencia: nao pode ser medido pela conta de B.
    await ligar(b, "ig-b", "EAA-B");
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoIgual"), views: 9999 }] });
    const videoA = await postar(a, "CodigoIgual");
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 12, likesCount: 1, commentsCount: 0 }] });

    await rodarCurvaCliente(agora);

    expect(chamadas).toHaveLength(0);
    expect(await medidaDe(videoA.id)).toMatchObject({ views: 12, fonte: "apify" });
  });

  it("o que a conta ligada nao achou cai para o usuario do sistema (se a marca tem meta_ig_id), e so entao", async () => {
    const d = await criarMarca("cl-d", { metaIgId: "ig-sistema-d" });
    await ligar(d, "ig-d", "EAA-D");
    contas.set("ig-d", { aceita: "EAA-D", midias: [] });
    contas.set("ig-sistema-d", { aceita: SISTEMA, midias: [{ id: "media-d", permalink: permalink("CodigoD"), views: 4321 }] });
    const video = await postar(d, "CodigoD");

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramMeta: 1, medidosInstagramContaLigada: 0, medidosInstagramApify: 0 });
    expect(chamadas.map((c) => [c.caminho, c.token])).toEqual([
      ["ig-d/media", "EAA-D"],
      ["ig-sistema-d/media", SISTEMA],
    ]);
    expect(await medidaDe(video.id)).toMatchObject({ views: 4321, fonte: "meta" });
  });
});

describe("quando o acesso de uma marca falha", () => {
  it("a Meta recusa o acesso de A (190): A cai para o Apify e a conta guarda a frase; B, de outra marca, continua lida normalmente; na rodada seguinte A nem e tentada", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    await ligar(a, "ig-a", "EAA-A");
    await ligar(b, "ig-b", "EAA-B");
    contas.set("ig-a", { aceita: "EAA-OUTRO-QUE-NAO-O-GUARDADO", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1 }] });
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 2222 }] });
    const videoA = await postar(a, "CodigoA");
    const videoB = await postar(b, "CodigoB");
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 55, likesCount: 5, commentsCount: 0 }] });

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramContaLigada: 1, medidosInstagramApify: 1 });
    expect(await medidaDe(videoA.id)).toMatchObject({ views: 55, fonte: "apify" });
    expect(await medidaDe(videoB.id)).toMatchObject({ views: 2222, fonte: "meta" });
    const [linhaA] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
    const [linhaB] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, b));
    expect(linhaA.erro).toBe(textosLigacao.erroDaConta.recusada);
    expect(linhaB.erro).toBeNull();
    expect(linhaB.ultimaLeituraEm).not.toBeNull();

    // Uma hora depois (outro video de A devido): a conta recusada nao e tentada de novo.
    chamadas.length = 0;
    await postar(a, "CodigoA2");
    await rodarCurvaCliente(new Date(agora.getTime() + 60 * 60 * 1000));
    expect(chamadas.filter((c) => c.token === "EAA-A")).toHaveLength(0);
  });

  it("falta de permissao (codigo 10) tambem e da conta, nao do aplicativo: so ela cai", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    await ligar(a, "ig-a", "EAA-A");
    await ligar(b, "ig-b", "EAA-B");
    contas.set("ig-a", { aceita: "EAA-A", midias: [], erro: { code: 10 } });
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 3 }] });
    await postar(a, "CodigoA");
    await postar(b, "CodigoB");
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 1, likesCount: 1, commentsCount: 1 }] });

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramContaLigada: 1, medidosInstagramApify: 1 });
    const [linhaA] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
    expect(linhaA.erro).toBe(textosLigacao.erroDaConta.semPermissao);
  });

  it("limite do APLICATIVO (codigo 4) para a Meta inteira pelo resto da rodada: as outras marcas ligadas vao ao Apify, sem nova chamada a Meta", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    await ligar(a, "ig-a", "EAA-A");
    await ligar(b, "ig-b", "EAA-B");
    contas.set("ig-a", { aceita: "EAA-A", midias: [], erro: { code: 4 } });
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 3 }] });
    await postar(a, "CodigoA");
    await postar(b, "CodigoB");
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 1, likesCount: 1, commentsCount: 1 }] });

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramContaLigada: 0, medidosInstagramApify: 2 });
    expect(chamadas).toHaveLength(1);
    // O limite nao e erro da conta: a frase da conta nao muda.
    const todas = await db().select().from(contasConectadas);
    expect(todas.every((l) => l.erro === null)).toBe(true);
  });

  it("conta candidata (ainda sem escolha), vencida ou com o acesso ilegivel: nao e lida, e a curva segue pelos outros caminhos", async () => {
    const a = await criarMarca("cl-a");
    const b = await criarMarca("cl-b");
    const c = await criarMarca("cl-c");
    await ligar(a, "ig-a", "EAA-A", { estado: "escolher" });
    await ligar(b, "ig-b", "EAA-B", { tokenExpiraEm: new Date(agora.getTime() - 1000) });
    await ligar(c, "ig-c", "EAA-C", { tokenCifrado: cifrarToken("EAA-C", contextoDoToken(999, "instagram", "ig-c")) });
    for (const [marca, codigo] of [[a, "CA"], [b, "CB"], [c, "CC"]] as const) await postar(marca, codigo);
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 1, likesCount: 1, commentsCount: 1 }] });

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramContaLigada: 0, medidosInstagramApify: 3 });
    expect(chamadas).toHaveLength(0);
  });
});
