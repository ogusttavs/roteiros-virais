/**
 * E19b: a curva lê os números da PRÓPRIA conta ligada pelo Login do Instagram (`graph.instagram.com`). Diferenças da via do Facebook, todas da documentação baixada: a mídia da lista não traz
 * `total_views_count` ("Disponível apenas para a API do Instagram com o Login do Facebook": `pesquisa/plataformas/docs/meta/ig-media-referencia.md`), então as visualizações vêm do `insights`
 * (métrica `views`, `ig-media-insights.md`); e não há `appsecret_proof`. A Graph API é o `fetch` simulado; o Apify é de mentira. O ponto central continua o ISOLAMENTO entre marcas.
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
      metaConexao: {
        ...original.config.metaConexao,
        appSecret: "segredo-do-app-do-facebook",
        tokenChave: Buffer.alloc(32, 13).toString("base64"),
        ativa: true,
        viaFacebookLigada: true,
        instagram: { appId: "990602627938098", appSecret: "segredo-do-app-do-instagram", redirectUri: "http://localhost:3000/api/meta/retorno", ativa: true },
      },
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
const agora = new Date("2026-10-27T12:00:00Z");
const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);

type Chamada = { host: string; caminho: string; token: string | null; proof: string | null; campos: string | null; metrica: string | null };
const chamadas: Chamada[] = [];
type ContaSimulada = { aceita: string; midias: { id: string; permalink: string; views: number }[]; erroNoInsights?: { code: number }; erro?: { code: number } };
const contas = new Map<string, ContaSimulada>();

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

/** A mídia como cada via a entrega: no Instagram sem `total_views_count`; no Facebook com ele. */
function midiaDe(m: { id: string; permalink: string; views: number }, host: string) {
  const base = { id: m.id, permalink: m.permalink, media_type: "VIDEO", media_product_type: "REELS", like_count: 10, comments_count: 2 };
  return host === "graph.instagram.com" ? base : { ...base, total_views_count: m.views };
}

function instalarGraph(): void {
  mockFetch.mockImplementation(async (entrada: URL | string) => {
    const url = new URL(String(entrada));
    const token = url.searchParams.get("access_token");
    const caminho = url.pathname.replace("/v26.0/", "");
    chamadas.push({ host: url.host, caminho, token, proof: url.searchParams.get("appsecret_proof"), campos: url.searchParams.get("fields"), metrica: url.searchParams.get("metric") });
    const partes = caminho.split("/");
    const [dono, resto] = partes;
    const conta = resto === "media" ? contas.get(dono) : [...contas.values()].find((c) => c.midias.some((m) => m.id === dono));
    if (!conta) return json({ error: { message: "Unsupported get request", code: 100 } }, 400);
    if (conta.erro) return json({ error: { message: "erro simulado", code: conta.erro.code } }, 400);
    if (token !== conta.aceita) return json({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400);
    if (resto === "media") return json({ data: conta.midias.map((m) => midiaDe(m, url.host)) });
    const midia = conta.midias.find((m) => m.id === dono)!;
    if (resto === "insights") {
      if (conta.erroNoInsights) return json({ error: { message: "erro simulado nos insights", code: conta.erroNoInsights.code } }, 400);
      return json({ data: [{ name: "views", period: "lifetime", values: [{ value: midia.views }], title: "Views" }] });
    }
    return json(midiaDe(midia, url.host));
  });
}

const idsUsuarios: string[] = [];

async function criarMarca(usuarioId: string): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${usuarioId}`, email: `${usuarioId}@curva-ig.teste` });
  idsUsuarios.push(usuarioId);
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${usuarioId}`, perfis: { instagram: null, tiktok: null, youtube: null } }).returning();
  return marca.id;
}

async function ligar(clienteId: number, igId: string, token: string, via: "instagram" | "facebook", extra: Partial<typeof contasConectadas.$inferInsert> = {}) {
  const [linha] = await db()
    .insert(contasConectadas)
    .values({
      clienteId,
      plataforma: "instagram",
      via,
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

describe("a curva lê pela conta ligada pelo Login do Instagram", () => {
  it("duas marcas: cada uma lida SÓ com o próprio acesso, no graph.instagram.com, sem total_views_count e sem prova do segredo; as visualizações vêm do insights; nenhum token cruza", async () => {
    const a = await criarMarca("ci-a");
    const b = await criarMarca("ci-b");
    await ligar(a, "ig-a", "IGQ-A", "instagram");
    await ligar(b, "ig-b", "IGQ-B", "instagram");
    contas.set("ig-a", { aceita: "IGQ-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1111 }] });
    contas.set("ig-b", { aceita: "IGQ-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 2222 }] });
    const videoA = await postar(a, "CodigoA");
    const videoB = await postar(b, "CodigoB");

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramMeta: 2, medidosInstagramContaLigada: 2, medidosInstagramApify: 0 });
    expect(actorCall).not.toHaveBeenCalled();
    expect(await medidaDe(videoA.id)).toMatchObject({ views: 1111, likes: 10, comentarios: 2, fonte: "meta" });
    expect(await medidaDe(videoB.id)).toMatchObject({ views: 2222, fonte: "meta" });

    expect(chamadas.every((c) => c.host === "graph.instagram.com")).toBe(true);
    expect(chamadas.map((c) => [c.caminho, c.token]).sort()).toEqual([
      ["ig-a/media", "IGQ-A"],
      ["ig-b/media", "IGQ-B"],
      ["media-a/insights", "IGQ-A"],
      ["media-b/insights", "IGQ-B"],
    ]);
    expect(chamadas.every((c) => c.token !== SISTEMA)).toBe(true);
    expect(chamadas.every((c) => c.proof === null)).toBe(true);
    const listas = chamadas.filter((c) => c.caminho.endsWith("/media"));
    for (const lista of listas) expect(lista.campos).not.toContain("total_views_count");
    expect(chamadas.filter((c) => c.caminho.endsWith("/insights")).every((c) => c.metrica === "views")).toBe(true);
    const [linhaA] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
    expect(linhaA.ultimaLeituraEm?.getTime()).toBe(agora.getTime());
    expect(linhaA.erro).toBeNull();
  });

  it("depois da primeira medição lê a mídia direto e as visualizações do insights, ainda com o acesso da própria marca", async () => {
    const a = await criarMarca("ci-a");
    await ligar(a, "ig-a", "IGQ-A", "instagram");
    contas.set("ig-a", { aceita: "IGQ-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 5000 }] });
    const video = await postar(a, "CodigoA", { metaMediaId: "media-a" });

    await rodarCurvaCliente(agora);

    expect(chamadas.map((c) => [c.host, c.caminho, c.token])).toEqual([
      ["graph.instagram.com", "media-a", "IGQ-A"],
      ["graph.instagram.com", "media-a/insights", "IGQ-A"],
    ]);
    expect((await medidaDe(video.id)).views).toBe(5000);
  });

  it("uma marca pela via do Instagram e outra pela do Facebook na mesma rodada: cada uma no servidor certo, com o acesso certo, e o total_views_count só na do Facebook", async () => {
    const a = await criarMarca("ci-a");
    const b = await criarMarca("ci-b");
    await ligar(a, "ig-a", "IGQ-A", "instagram");
    await ligar(b, "ig-b", "EAA-B", "facebook");
    contas.set("ig-a", { aceita: "IGQ-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 111 }] });
    contas.set("ig-b", { aceita: "EAA-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 222 }] });
    const videoA = await postar(a, "CodigoA");
    const videoB = await postar(b, "CodigoB");

    await rodarCurvaCliente(agora);

    expect((await medidaDe(videoA.id)).views).toBe(111);
    expect((await medidaDe(videoB.id)).views).toBe(222);
    const deA = chamadas.filter((c) => c.token === "IGQ-A");
    const deB = chamadas.filter((c) => c.token === "EAA-B");
    expect(deA.length).toBeGreaterThan(0);
    expect(deA.every((c) => c.host === "graph.instagram.com" && c.proof === null)).toBe(true);
    expect(deB.every((c) => c.host === "graph.facebook.com" && c.proof !== null)).toBe(true);
    expect(deB.some((c) => c.caminho.endsWith("/insights"))).toBe(false);
    expect(deB.find((c) => c.caminho.endsWith("/media"))?.campos).toContain("total_views_count");
  });

  it("sem a permissão de números (erro 10 no insights): a conta ganha a frase de ligar de novo, o vídeo cai para o Apify, e a outra marca segue lida normalmente", async () => {
    const a = await criarMarca("ci-a");
    const b = await criarMarca("ci-b");
    await ligar(a, "ig-a", "IGQ-A", "instagram");
    await ligar(b, "ig-b", "IGQ-B", "instagram");
    contas.set("ig-a", { aceita: "IGQ-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1 }], erroNoInsights: { code: 10 } });
    contas.set("ig-b", { aceita: "IGQ-B", midias: [{ id: "media-b", permalink: permalink("CodigoB"), views: 2222 }] });
    const videoA = await postar(a, "CodigoA");
    const videoB = await postar(b, "CodigoB");

    await rodarCurvaCliente(agora);

    expect(await medidaDe(videoA.id)).toBeUndefined();
    expect((await medidaDe(videoB.id)).views).toBe(2222);
    const [linhaA] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
    expect(linhaA.erro).toBe(textosLigacao.erroDaConta.semPermissao);
    const [linhaB] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, b));
    expect(linhaB.erro).toBeNull();
  });

  it("acesso recusado (190) pela Meta: a conta ganha a frase e não é tentada de novo na rodada seguinte", async () => {
    const a = await criarMarca("ci-a");
    await ligar(a, "ig-a", "IGQ-A", "instagram");
    contas.set("ig-a", { aceita: "OUTRO", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1 }] });
    await postar(a, "CodigoA");
    await rodarCurvaCliente(agora);
    const [linha] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
    expect(linha.erro).toBe(textosLigacao.erroDaConta.recusada);
    chamadas.length = 0;
    await rodarCurvaCliente(new Date(agora.getTime() + 3_600_000));
    expect(chamadas.filter((c) => c.token === "IGQ-A")).toHaveLength(0);
  });

  it("conta de uma via que o ambiente não tem ligada não é lida: o vídeo segue para o caminho de sempre, sem erro na conta", async () => {
    const mod = await import("@/lib/config");
    mod.config.metaConexao.instagram.ativa = false;
    try {
      const a = await criarMarca("ci-a");
      await ligar(a, "ig-a", "IGQ-A", "instagram");
      contas.set("ig-a", { aceita: "IGQ-A", midias: [{ id: "media-a", permalink: permalink("CodigoA"), views: 1 }] });
      await postar(a, "CodigoA");
      await rodarCurvaCliente(agora);
      expect(chamadas.filter((c) => c.token === "IGQ-A")).toHaveLength(0);
      const [linha] = await db().select().from(contasConectadas).where(eq(contasConectadas.clienteId, a));
      expect(linha.erro).toBeNull();
    } finally {
      mod.config.metaConexao.instagram.ativa = true;
    }
  });
});
