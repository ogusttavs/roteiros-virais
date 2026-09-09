/**
 * Job `contas-base` (E6 parte 3, item 5) contra o Postgres real, com o
 * Apify mockado (mesmo padrao de `coleta-apify.test.ts`) e a rede do
 * YouTube mockada (mesmo padrao de `coleta-youtube.test.ts`): prioriza por
 * views, respeita o teto diario do Apify, e marca `contas.base_completa_em`
 * depois do catch-up de cada conta.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, nichos, videos } from "@/db/schema";
import type { TiktokItemBruto } from "@/jobs/apify-api";
import { rodarContasBase } from "@/jobs/contas-base";
import { config, hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarTiktok: vi.fn(), buscarInstagram: vi.fn() };
});

// eslint-disable-next-line import/order -- vi.mock acima e hoisted; este import precisa vir depois para pegar o mock.
import { buscarInstagram, buscarTiktok } from "@/jobs/apify-api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

function itemTiktok(handle: string, videoId: string): TiktokItemBruto {
  return {
    id: videoId,
    text: `[exemplo] video novo de ${handle}`,
    webVideoUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
    createTimeISO: "2026-08-20T00:00:00.000Z",
    authorMeta: { name: handle, nickName: handle },
    playCount: 1,
  };
}

let nichoId: number;

async function criarContaComVideo(
  plataforma: "tiktok" | "instagram" | "youtube",
  handle: string,
  views: number,
  opts?: { baseCompletaEm?: Date; semVideo?: boolean },
): Promise<number> {
  const [c] = await db()
    .insert(contas)
    .values({ plataforma, handle, nichoId, baseCompletaEm: opts?.baseCompletaEm ?? null })
    .returning({ id: contas.id });
  if (!opts?.semVideo) {
    await db()
      .insert(videos)
      .values({
        plataforma,
        idExterno: `${handle}-seed`,
        url: `https://exemplo.invalido/${handle}-seed`,
        contaId: c.id,
        nichoId,
        views,
        publicadoEm: new Date(),
      });
  }
  return c.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "contas-base-teste", nome: "Contas base teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(buscarTiktok).mockReset();
  vi.mocked(buscarInstagram).mockReset();
  mockFetch.mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  await db().delete(consumoApi);
});

describe("rodarContasBase", () => {
  it("prioriza por views e respeita o teto: a conta com mais views e atendida primeiro, a outra fica para amanha", async () => {
    const contaBaixa = await criarContaComVideo("tiktok", "conta-baixa-views", 100);
    const contaAlta = await criarContaComVideo("tiktok", "conta-alta-views", 99999);

    const teto = config.coleta.apifyMaxResultadosDia;
    await db().insert(consumoApi).values({ fonte: "apify", data: hojeISO(), unidades: teto - 1 });

    vi.mocked(buscarTiktok).mockImplementation(async (_hashtags, perfis) => {
      const handle = perfis[0];
      return { itens: [itemTiktok(handle, `${handle}-novo`)], devolvidos: 1 };
    });

    const resumo = await rodarContasBase();

    expect(resumo.tetoAtingido).toBe(true);
    expect(resumo.contasProcessadas).toBe(1);
    expect(buscarTiktok).toHaveBeenCalledTimes(1);
    expect(buscarTiktok).toHaveBeenCalledWith([], ["conta-alta-views"], 10);

    const [linhaAlta] = await db().select().from(contas).where(eq(contas.id, contaAlta));
    const [linhaBaixa] = await db().select().from(contas).where(eq(contas.id, contaBaixa));
    expect(linhaAlta.baseCompletaEm).not.toBeNull();
    expect(linhaBaixa.baseCompletaEm).toBeNull();
  });

  it("youtube: busca a playlist de uploads e videos.list, grava o video novo e marca a conta", async () => {
    const contaId = await criarContaComVideo("youtube", "UCexemplobase00000001", 500);

    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("/channels")) {
        return respostaJson({
          items: [
            {
              id: "UCexemplobase00000001",
              snippet: { title: "[exemplo] canal com pouca base" },
              contentDetails: { relatedPlaylists: { uploads: "UUexemplobase00000001" } },
            },
          ],
        });
      }
      if (texto.includes("/playlistItems")) {
        return respostaJson({
          items: [
            { snippet: { resourceId: { videoId: "exVidBase1" }, publishedAt: "2026-08-25T00:00:00Z" } },
          ],
        });
      }
      if (texto.includes("/videos")) {
        return respostaJson({
          items: [
            {
              id: "exVidBase1",
              snippet: {
                channelId: "UCexemplobase00000001",
                channelTitle: "[exemplo] canal com pouca base",
                title: "[exemplo] video novo",
                description: "",
                publishedAt: "2026-08-25T00:00:00Z",
              },
              contentDetails: { duration: "PT20S" },
              statistics: { viewCount: "10", likeCount: "1", commentCount: "0" },
            },
          ],
        });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const resumo = await rodarContasBase();
    expect(resumo.videosNovos).toBe(1);

    const [linha] = await db().select().from(contas).where(eq(contas.id, contaId));
    expect(linha.baseCompletaEm).not.toBeNull();

    const [videoNovo] = await db().select().from(videos).where(eq(videos.idExterno, "exVidBase1"));
    expect(videoNovo).toBeDefined();
  });

  it("conta ja marcada (base_completa_em) nunca e selecionada de novo, mesmo com menos de 5 videos", async () => {
    await criarContaComVideo("tiktok", "conta-ja-tentada", 500, { baseCompletaEm: new Date() });

    const resumo = await rodarContasBase();

    expect(resumo.contasProcessadas).toBe(0);
    expect(buscarTiktok).not.toHaveBeenCalled();
  });

  it("conta com 5 videos ou mais ja tem base, nunca e selecionada", async () => {
    const contaId = await criarContaComVideo("tiktok", "conta-com-base", 100, { semVideo: true });
    for (let i = 0; i < 5; i += 1) {
      await db()
        .insert(videos)
        .values({
          plataforma: "tiktok",
          idExterno: `conta-com-base-${i}`,
          url: `https://exemplo.invalido/conta-com-base-${i}`,
          contaId,
          nichoId,
          views: 100,
          publicadoEm: new Date(),
        });
    }

    const resumo = await rodarContasBase();

    expect(resumo.contasProcessadas).toBe(0);
    expect(buscarTiktok).not.toHaveBeenCalled();
  });

  it("conta sem nenhum video nunca e selecionada (sem video de mais views para priorizar)", async () => {
    await criarContaComVideo("tiktok", "conta-sem-video", 0, { semVideo: true });

    const resumo = await rodarContasBase();

    expect(resumo.contasProcessadas).toBe(0);
    expect(buscarTiktok).not.toHaveBeenCalled();
  });
});
