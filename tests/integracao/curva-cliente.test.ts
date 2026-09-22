/**
 * Job `curva-cliente` (etapa 15, parte 1; V8, itens 1 e 2): YouTube com a
 * rede mockada e o banco real. A cadencia com relogio fabricado ja tem teste
 * puro em `src/servicos/curva.test.ts`; aqui o que importa e o ciclo
 * completo do job: uma rodada mede e grava, rodar de novo no mesmo
 * intervalo nao duplica (criterio de aceite da etapa, `PROXIMO.md`). O
 * Instagram pela Meta (V8) mede pela mesma rede mockada (`fetch`); o
 * Instagram e o TikTok pelo Apify (reserva) usam o Apify de mentira abaixo,
 * no mesmo padrao de `apify-api.test.ts`.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      coleta: { ...original.config.coleta, metaAtivo: true, metaIgId: "sistema-ig", metaToken: "EAAtoken-de-teste" },
    },
  };
});

const actorCall = vi.fn();
const datasetListItems = vi.fn();

/** Mesmo molde de `apify-api.test.ts`: `new ApifyClient(...)` precisa de uma funcao construtora de verdade. */
vi.mock("apify-client", () => ({
  ApifyClient: vi.fn().mockImplementation(function ApifyClientFalso(this: {
    actor: () => { call: typeof actorCall };
    dataset: () => { listItems: typeof datasetListItems };
  }) {
    this.actor = () => ({ call: actorCall });
    this.dataset = () => ({ listItems: datasetListItems });
  }),
}));

import { db, getPool } from "@/db";
import { clientes, consumoApi, metricasVideoCliente, user, videosCliente } from "@/db/schema";
import { rodarCurvaCliente } from "@/jobs/curva-cliente";

import { resetarSchema } from "../../scripts/resetar-schema";

/**
 * `fetch` e lido dentro de `src/jobs/youtube-api.ts` so no momento da
 * chamada, entao o stub global vale mesmo declarado depois do import de
 * `rodarCurvaCliente` (mesmo achado de `coleta-youtube.test.ts`).
 */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function itemVideo(id: string, views: number) {
  return {
    id,
    snippet: {
      channelId: "UCexemplo00000000009",
      channelTitle: "[exemplo] Canal de teste",
      title: `[exemplo] video ${id}`,
      description: "[exemplo] descricao de teste",
      publishedAt: "2026-08-20T00:00:00Z",
    },
    contentDetails: { duration: "PT30S" },
    statistics: { viewCount: String(views), likeCount: "10", commentCount: "2" },
  };
}

let clienteId: number;
/** Usuarios criados por `criarClienteInstagram`, apagados (com o cliente junto, onDelete cascade) a cada teste. */
const idsUsuariosInstagram: string[] = [];

beforeAll(async () => {
  await resetarSchema(db());
  await db()
    .insert(user)
    .values({ id: "curva-cliente-teste", name: "[teste] cliente curva", email: "curva-cliente-teste@curva.teste" });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: "curva-cliente-teste", nome: "[teste] cliente curva" })
    .returning();
  clienteId = cliente.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  mockFetch.mockReset();
  actorCall.mockReset().mockResolvedValue({ defaultDatasetId: "ds1" });
  datasetListItems.mockReset().mockResolvedValue({ items: [] });
});

afterEach(async () => {
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(consumoApi);
  if (idsUsuariosInstagram.length > 0) {
    await db().delete(user).where(inArray(user.id, idsUsuariosInstagram));
    idsUsuariosInstagram.length = 0;
  }
});

/** Um cliente proprio (V8): so para os testes do Instagram, com `metaIgId` e/ou o perfil que cada teste precisar. */
async function criarClienteInstagram(
  usuarioId: string,
  opts: { metaIgId?: string | null; instagram?: string | null } = {},
): Promise<number> {
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] ${usuarioId}`, email: `${usuarioId}@curva.teste` });
  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome: `[teste] ${usuarioId}`,
      metaIgId: opts.metaIgId ?? null,
      perfis: { instagram: opts.instagram ?? null, tiktok: null, youtube: null },
    })
    .returning();
  idsUsuariosInstagram.push(usuarioId);
  return cliente.id;
}

/** Resposta de `/{igId}/media` ou `/{mediaId}` (V8, item 2): so os campos que `curva-cliente.ts` le. */
function itemMedia(opts: { id: string; permalink?: string; views: number; likes?: number; comentarios?: number }) {
  return {
    id: opts.id,
    permalink: opts.permalink,
    media_type: "VIDEO",
    media_product_type: "REELS",
    total_views_count: opts.views,
    like_count: opts.likes ?? 10,
    comments_count: opts.comentarios ?? 2,
  };
}

describe("rodarCurvaCliente (YouTube, rede mockada, banco real)", () => {
  it("uma rodada mede e grava; rodar de novo no mesmo intervalo nao mede de novo", async () => {
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);

    const inseridos = await db()
      .insert(videosCliente)
      .values([
        { clienteId, plataforma: "youtube", url: "https://youtu.be/vid1", idExterno: "vid1", postadoEm },
        { clienteId, plataforma: "youtube", url: "https://youtu.be/vid2", idExterno: "vid2", postadoEm },
      ])
      .returning();

    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("/videos")) {
        return respostaJson({ items: [itemVideo("vid1", 1000), itemVideo("vid2", 2000)] });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const primeiraRodada = await rodarCurvaCliente(agora);
    expect(primeiraRodada.medidosYoutube).toBe(2);

    const metricas = await db().select().from(metricasVideoCliente);
    expect(metricas).toHaveLength(2);
    const viewsPorVideo = new Map(metricas.map((m) => [m.videoClienteId, m.views]));
    expect(viewsPorVideo.get(inseridos[0].id)).toBe(1000);
    expect(viewsPorVideo.get(inseridos[1].id)).toBe(2000);

    const linhas = await db().select().from(videosCliente).where(eq(videosCliente.clienteId, clienteId));
    for (const linha of linhas) {
      expect(linha.ultimaColeta?.getTime()).toBe(agora.getTime());
    }

    const [consumo] = await db().select().from(consumoApi).where(eq(consumoApi.fonte, "youtube"));
    expect(consumo.unidades).toBe(1);

    const segundaRodada = await rodarCurvaCliente(agora);
    expect(segundaRodada.medidosYoutube).toBe(0);

    const metricasDepois = await db().select().from(metricasVideoCliente);
    expect(metricasDepois).toHaveLength(2);

    const [consumoDepois] = await db().select().from(consumoApi).where(eq(consumoApi.fonte, "youtube"));
    expect(consumoDepois.unidades).toBe(1);
  });

  it("sem nenhum video devido, nao chama a rede", async () => {
    const resumo = await rodarCurvaCliente(new Date("2026-09-06T12:00:00Z"));
    expect(resumo).toMatchObject({ candidatos: 0, devidos: 0, medidosYoutube: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("rodarCurvaCliente (Instagram pela Meta, com reserva no Apify; V8, itens 1 e 2)", () => {
  it("cliente com meta_ig_id ja resolvido: acha o video na midia da conta, mede pela Meta e guarda o media id", async () => {
    const cid = await criarClienteInstagram("v8-meta-um", { metaIgId: "ig-cliente-1" });
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    const [video] = await db()
      .insert(videosCliente)
      .values({
        clienteId: cid,
        plataforma: "instagram",
        url: "https://www.instagram.com/reel/Cexemplo1/",
        idExterno: "Cexemplo1",
        postadoEm,
      })
      .returning();

    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("ig-cliente-1/media")) {
        return respostaJson({
          data: [itemMedia({ id: "media1", permalink: "https://www.instagram.com/reel/Cexemplo1/", views: 5000, likes: 200, comentarios: 15 })],
        });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const resumo = await rodarCurvaCliente(agora);
    expect(resumo).toMatchObject({ medidosInstagramMeta: 1, medidosInstagramApify: 0 });
    expect(actorCall).not.toHaveBeenCalled();

    const [metrica] = await db().select().from(metricasVideoCliente).where(eq(metricasVideoCliente.videoClienteId, video.id));
    expect(metrica).toMatchObject({ views: 5000, likes: 200, comentarios: 15, fonte: "meta" });

    const [videoDepois] = await db().select().from(videosCliente).where(eq(videosCliente.id, video.id));
    expect(videoDepois.metaMediaId).toBe("media1");
  });

  it("cliente sem meta_ig_id e sem Instagram no perfil (fora do portfolio de Paginas): direto pro apify, nunca tenta a Meta", async () => {
    const cid = await criarClienteInstagram("v8-meta-sem-id");
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    await db().insert(videosCliente).values({
      clienteId: cid,
      plataforma: "instagram",
      url: "https://www.instagram.com/reel/CsemId/",
      idExterno: "CsemId",
      postadoEm,
    });
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 3000, likesCount: 50, commentsCount: 4 }] });

    const resumo = await rodarCurvaCliente(agora);

    expect(resumo).toMatchObject({ medidosInstagramMeta: 0, medidosInstagramApify: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(actorCall).toHaveBeenCalledTimes(1);

    const [metrica] = await db().select().from(metricasVideoCliente);
    expect(metrica).toMatchObject({ views: 3000, likes: 50, comentarios: 4, fonte: "apify" });
  });

  it("com meta_media_id ja guardado, le so essa midia direto (uma chamada, sem listar a conta de novo)", async () => {
    const cid = await criarClienteInstagram("v8-meta-dois", { metaIgId: "ig-cliente-2" });
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    const [video] = await db()
      .insert(videosCliente)
      .values({
        clienteId: cid,
        plataforma: "instagram",
        url: "https://www.instagram.com/reel/Cexemplo2/",
        idExterno: "Cexemplo2",
        postadoEm,
        metaMediaId: "media2",
      })
      .returning();

    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("/media2")) return respostaJson(itemMedia({ id: "media2", views: 9000, likes: 300, comentarios: 20 }));
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const resumo = await rodarCurvaCliente(agora);
    expect(resumo.medidosInstagramMeta).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0].toString()).not.toContain("ig-cliente-2/media?");

    const [metrica] = await db().select().from(metricasVideoCliente).where(eq(metricasVideoCliente.videoClienteId, video.id));
    expect(metrica).toMatchObject({ views: 9000, likes: 300, comentarios: 20, fonte: "meta" });
  });

  it("video nao encontrado na midia da conta (postado fora do app, ou apagado): cai para o apify", async () => {
    const cid = await criarClienteInstagram("v8-meta-tres", { metaIgId: "ig-cliente-3" });
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    await db().insert(videosCliente).values({
      clienteId: cid,
      plataforma: "instagram",
      url: "https://www.instagram.com/reel/CnaoAchado/",
      idExterno: "CnaoAchado",
      postadoEm,
    });

    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("ig-cliente-3/media")) {
        return respostaJson({ data: [itemMedia({ id: "outro", permalink: "https://www.instagram.com/reel/OutroVideo/", views: 1 })] });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 4200, likesCount: 100, commentsCount: 8 }] });

    const resumo = await rodarCurvaCliente(agora);
    expect(resumo).toMatchObject({ medidosInstagramMeta: 0, medidosInstagramApify: 1 });
    expect(actorCall).toHaveBeenCalledTimes(1);

    const [metrica] = await db().select().from(metricasVideoCliente);
    expect(metrica).toMatchObject({ views: 4200, likes: 100, comentarios: 8, fonte: "apify" });
  });

  it("cliente sem meta_ig_id ainda, mas com o Instagram no perfil: resolve na hora (opportunista) e mede pela Meta", async () => {
    const cid = await criarClienteInstagram("v8-meta-quatro", { instagram: "clientequatro" });
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    await db().insert(videosCliente).values({
      clienteId: cid,
      plataforma: "instagram",
      url: "https://www.instagram.com/reel/Cexemplo4/",
      idExterno: "Cexemplo4",
      postadoEm,
    });

    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("me/accounts")) {
        return respostaJson({
          data: [{ id: "pagina4", name: "[teste] pagina 4", instagram_business_account: { id: "ig-cliente-4", username: "clientequatro" } }],
        });
      }
      if (texto.includes("ig-cliente-4/media")) {
        return respostaJson({ data: [itemMedia({ id: "media4", permalink: "https://www.instagram.com/reel/Cexemplo4/", views: 7000 })] });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const resumo = await rodarCurvaCliente(agora);
    expect(resumo.medidosInstagramMeta).toBe(1);

    const [clienteDepois] = await db().select({ metaIgId: clientes.metaIgId }).from(clientes).where(eq(clientes.id, cid));
    expect(clienteDepois.metaIgId).toBe("ig-cliente-4");
  });

  it("token vencido ou limite da Meta batido: para de tentar a Meta pelo resto da rodada, e o resto cai para o apify", async () => {
    const cidA = await criarClienteInstagram("v8-meta-cinco-a", { metaIgId: "ig-cliente-5a" });
    const cidB = await criarClienteInstagram("v8-meta-cinco-b", { metaIgId: "ig-cliente-5b" });
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    await db()
      .insert(videosCliente)
      .values([
        { clienteId: cidA, plataforma: "instagram", url: "https://www.instagram.com/reel/C5a/", idExterno: "C5a", postadoEm },
        { clienteId: cidB, plataforma: "instagram", url: "https://www.instagram.com/reel/C5b/", idExterno: "C5b", postadoEm },
      ]);

    let chamadasParaMedia = 0;
    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("/media")) {
        chamadasParaMedia += 1;
        return respostaJson({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 1000, likesCount: 5, commentsCount: 1 }] });

    const resumo = await rodarCurvaCliente(agora);

    // So o primeiro cliente tenta a Meta (e leva o erro de token); o segundo nunca chega a tentar.
    expect(chamadasParaMedia).toBe(1);
    expect(resumo).toMatchObject({ medidosInstagramMeta: 0, medidosInstagramApify: 2 });
    expect(actorCall).toHaveBeenCalledTimes(2);
  });

  /**
   * Achado da revisao da V8: o erro de token/limite tambem pode acontecer durante a RESOLUCAO
   * (`resolverMetaIgId`, opportunista, cliente ainda sem `meta_ig_id`), nao so durante a medicao.
   * Sem tratar esse caso, cada cliente sem id resolvido tentaria `me/accounts` de novo, um por um,
   * em vez de a rodada parar no primeiro erro.
   */
  it("token vencido durante a resolucao opportunista (clientes sem meta_ig_id ainda): tambem para de tentar a Meta pelo resto da rodada", async () => {
    const cidA = await criarClienteInstagram("v8-meta-seis-a", { instagram: "clienteseisa" });
    const cidB = await criarClienteInstagram("v8-meta-seis-b", { instagram: "clienteseisb" });
    const agora = new Date("2026-09-06T12:00:00Z");
    const postadoEm = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
    await db()
      .insert(videosCliente)
      .values([
        { clienteId: cidA, plataforma: "instagram", url: "https://www.instagram.com/reel/C6a/", idExterno: "C6a", postadoEm },
        { clienteId: cidB, plataforma: "instagram", url: "https://www.instagram.com/reel/C6b/", idExterno: "C6b", postadoEm },
      ]);

    let chamadasParaContas = 0;
    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("me/accounts")) {
        chamadasParaContas += 1;
        return respostaJson({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });
    datasetListItems.mockResolvedValue({ items: [{ videoViewCount: 1000, likesCount: 5, commentsCount: 1 }] });

    const resumo = await rodarCurvaCliente(agora);

    // So o primeiro cliente tenta resolver o id (e leva o erro de token); o segundo nunca chega a tentar.
    expect(chamadasParaContas).toBe(1);
    expect(resumo).toMatchObject({ medidosInstagramMeta: 0, medidosInstagramApify: 2 });
    expect(actorCall).toHaveBeenCalledTimes(2);
  });
});
