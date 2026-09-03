/**
 * Ciclo completo da coleta do YouTube contra o Postgres real, com a rede
 * mockada (etapa 6, criterio de aceite): busca, normaliza, grava video e
 * conta, idempotencia (rodar duas vezes atualiza em vez de duplicar), e
 * registra o consumo de cota em consumo_api.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, nichos, videos } from "@/db/schema";
import { rodarColetaYoutube } from "@/jobs/coleta-youtube";
import { ErroColeta } from "@/jobs/execucoes";
import { hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

/**
 * `fetch` e lido dentro de `src/jobs/youtube-api.ts` so no momento da
 * chamada (nao no import), entao o stub global vale mesmo tendo sido
 * declarado depois do import de `rodarColetaYoutube` aqui em cima.
 */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function itemBusca(videoId: string) {
  return {
    id: { videoId },
    snippet: {
      channelId: "UCexemplo00000000009",
      channelTitle: "[exemplo] Canal de teste",
      title: `[exemplo] video ${videoId}`,
      description: "[exemplo] descricao de teste",
      publishedAt: "2026-08-20T00:00:00Z",
    },
  };
}

function itemVideo(videoId: string, views: number) {
  return {
    id: videoId,
    snippet: {
      channelId: "UCexemplo00000000009",
      channelTitle: "[exemplo] Canal de teste",
      title: `[exemplo] video ${videoId}`,
      description: "[exemplo] descricao de teste",
      publishedAt: "2026-08-20T00:00:00Z",
    },
    contentDetails: { duration: "PT30S" },
    statistics: { viewCount: String(views), likeCount: "10", commentCount: "2" },
  };
}

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "coleta-youtube-teste", nome: "Coleta YouTube teste", termos: ["dentista"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  await db().delete(consumoApi);
});

function mockarBuscaEVideo(videoId: string, views: number) {
  mockFetch.mockImplementation(async (url: URL) => {
    const texto = url.toString();
    if (texto.includes("/search")) return respostaJson({ items: [itemBusca(videoId)] });
    if (texto.includes("/videos")) return respostaJson({ items: [itemVideo(videoId, views)] });
    throw new Error(`chamada inesperada nesta fixture: ${texto}`);
  });
}

describe("rodarColetaYoutube (rede mockada, banco real)", () => {
  it("busca por termo, normaliza e grava video e conta novos", async () => {
    mockarBuscaEVideo("exVidNovo1", 1000);

    const resumo = await rodarColetaYoutube();
    expect(resumo.videosNovos).toBe(1);
    expect(resumo.videosAtualizados).toBe(0);

    const [videoGravado] = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "youtube"), eq(videos.idExterno, "exVidNovo1")));
    expect(videoGravado).toBeDefined();
    expect(videoGravado.views).toBe(1000);
    expect(videoGravado.origem).toBe("coleta");

    const [contaGravada] = await db()
      .select()
      .from(contas)
      .where(and(eq(contas.plataforma, "youtube"), eq(contas.handle, "UCexemplo00000000009")));
    expect(contaGravada).toBeDefined();
  });

  it("rodar duas vezes para o mesmo video atualiza em vez de duplicar (idempotencia)", async () => {
    mockarBuscaEVideo("exVidRepetido", 500);
    await rodarColetaYoutube();

    mockarBuscaEVideo("exVidRepetido", 900);
    const resumo = await rodarColetaYoutube();
    expect(resumo.videosNovos).toBe(0);
    expect(resumo.videosAtualizados).toBe(1);

    const linhas = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "youtube"), eq(videos.idExterno, "exVidRepetido")));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].views).toBe(900);
  });

  it("registra o consumo de cota do dia em consumo_api", async () => {
    mockarBuscaEVideo("exVidCota", 10);
    await rodarColetaYoutube();

    const [linha] = await db()
      .select()
      .from(consumoApi)
      .where(and(eq(consumoApi.fonte, "youtube"), eq(consumoApi.data, hojeISO())));
    // 1 termo (search.list, 100) + 1 lote de videos.list (1) = 101.
    expect(linha.unidades).toBe(101);
  });

  it("uma chamada que falha ainda assim consome a cota (o youtube cobra mesmo em erro)", async () => {
    mockFetch.mockImplementation(async (url: URL) => {
      if (url.toString().includes("/search")) throw new Error("timeout simulado");
      throw new Error(`chamada inesperada nesta fixture: ${url.toString()}`);
    });

    await expect(rodarColetaYoutube()).rejects.toThrow(ErroColeta);

    const [linha] = await db()
      .select()
      .from(consumoApi)
      .where(and(eq(consumoApi.fonte, "youtube"), eq(consumoApi.data, hojeISO())));
    // A busca falhou, mas a cota (100, search.list) ja tinha sido contada antes da chamada.
    expect(linha.unidades).toBe(100);
  });
});
