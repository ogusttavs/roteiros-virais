/**
 * Job `curva-cliente` (etapa 15, parte 1): YouTube com a rede mockada e o
 * banco real. A cadencia com relogio fabricado ja tem teste puro em
 * `src/servicos/curva.test.ts`; aqui o que importa e o ciclo completo do
 * job: uma rodada mede e grava, rodar de novo no mesmo intervalo nao
 * duplica (criterio de aceite da etapa, `PROXIMO.md`).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
});

afterEach(async () => {
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(consumoApi);
});

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
