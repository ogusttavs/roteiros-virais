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
import { buscarBusinessDiscovery, ErroMetaApi } from "@/jobs/meta-api";
import { config, hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarTiktok: vi.fn(), buscarInstagram: vi.fn() };
});

vi.mock("@/jobs/meta-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/meta-api")>();
  return { ...original, buscarBusinessDiscovery: vi.fn() };
});

// eslint-disable-next-line import/order -- vi.mock acima e hoisted; os imports abaixo precisam vir depois para pegar o mock.
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
  opts?: { baseCompletaEm?: Date; semVideo?: boolean; apiIndisponivelEm?: Date },
): Promise<number> {
  const [c] = await db()
    .insert(contas)
    .values({
      plataforma,
      handle,
      nichoId,
      baseCompletaEm: opts?.baseCompletaEm ?? null,
      apiIndisponivelEm: opts?.apiIndisponivelEm ?? null,
    })
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
  vi.mocked(buscarBusinessDiscovery).mockReset();
  mockFetch.mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  await db().delete(consumoApi);
  config.coleta.metaAtivo = false;
});

describe("rodarContasBase", () => {
  it("prioriza por views e respeita o teto: tiktok depois do teto fica para amanha, mas o youtube entre eles ainda e atendido (revisao do PR #34, item 0b)", async () => {
    const contaBaixa = await criarContaComVideo("tiktok", "conta-baixa-views", 100);
    const contaYoutube = await criarContaComVideo("youtube", "UCentreostiktok0000001", 50000);
    const contaAlta = await criarContaComVideo("tiktok", "conta-alta-views", 99999);

    const teto = config.coleta.apifyMaxResultadosDia;
    await db().insert(consumoApi).values({ fonte: "apify", data: hojeISO(), unidades: teto - 1 });

    vi.mocked(buscarTiktok).mockImplementation(async (_hashtags, perfis) => {
      const handle = perfis[0];
      return { itens: [itemTiktok(handle, `${handle}-novo`)], devolvidos: 1 };
    });
    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("/channels")) {
        return respostaJson({
          items: [
            {
              id: "UCentreostiktok0000001",
              snippet: { title: "[exemplo] canal entre os dois tiktoks" },
              contentDetails: { relatedPlaylists: { uploads: "UUentreostiktok0000001" } },
            },
          ],
        });
      }
      if (texto.includes("/playlistItems")) return respostaJson({ items: [] });
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const resumo = await rodarContasBase();

    // Ordem por views: alta (99999) > youtube (50000) > baixa (100). O teto so
    // cabe mais 1 resultado do apify: a alta usa esse espaco; a do meio e
    // youtube, sem trava de apify, e atendida mesmo com o teto ja batido; a
    // baixa (tiktok, depois do teto) fica para amanha.
    expect(resumo.tetoAtingido).toBe(true);
    expect(resumo.contasProcessadas).toBe(2);
    expect(buscarTiktok).toHaveBeenCalledTimes(1);
    expect(buscarTiktok).toHaveBeenCalledWith([], ["conta-alta-views"], 10);

    const [linhaAlta] = await db().select().from(contas).where(eq(contas.id, contaAlta));
    const [linhaYoutube] = await db().select().from(contas).where(eq(contas.id, contaYoutube));
    const [linhaBaixa] = await db().select().from(contas).where(eq(contas.id, contaBaixa));
    expect(linhaAlta.baseCompletaEm).not.toBeNull();
    expect(linhaYoutube.baseCompletaEm).not.toBeNull();
    expect(linhaBaixa.baseCompletaEm).toBeNull();
  });

  it("registra em consumo_api os resultados consumidos (itens.length), nao os devolvidos brutos (revisao do PR #34, item 0c)", async () => {
    await criarContaComVideo("tiktok", "conta-devolvidos-vs-usados", 500);

    vi.mocked(buscarTiktok).mockResolvedValue({
      itens: [itemTiktok("conta-devolvidos-vs-usados", "video-1")],
      devolvidos: 7,
    });

    const resumo = await rodarContasBase();
    expect(resumo.resultadosApifyDevolvidos).toBe(7);

    const [linha] = await db()
      .select()
      .from(consumoApi)
      .where(eq(consumoApi.fonte, "apify"));
    expect(linha.unidades).toBe(1);
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

  describe("instagram pela api da meta (E6 parte 3, segunda rodada, item 2)", () => {
    it("com meta ativo, usa a business discovery em vez do apify, grava os videos com origem meta e marca a leitura", async () => {
      config.coleta.metaAtivo = true;
      const contaId = await criarContaComVideo("instagram", "conta-meta-base", 100);

      vi.mocked(buscarBusinessDiscovery).mockResolvedValue({
        username: "conta-meta-base",
        followers_count: 5000,
        media: {
          data: [
            {
              id: "1",
              media_type: "VIDEO",
              timestamp: "2026-08-20T10:00:00.000Z",
              view_count: 900,
              like_count: 50,
              comments_count: 3,
              permalink: "https://www.instagram.com/p/ExemploMeta01/",
              caption: "[exemplo] video pego pela meta",
            },
          ],
        },
      });

      const resumo = await rodarContasBase();

      expect(resumo.videosNovos).toBe(1);
      expect(buscarInstagram).not.toHaveBeenCalled();

      const [linhaConta] = await db().select().from(contas).where(eq(contas.id, contaId));
      expect(linhaConta.baseCompletaEm).not.toBeNull();
      expect(linhaConta.ultimaLeituraMetaEm).not.toBeNull();
      expect(linhaConta.seguidores).toBe(5000);

      const [video] = await db().select().from(videos).where(eq(videos.idExterno, "ExemploMeta01"));
      expect(video).toBeDefined();
      expect(video.origem).toBe("meta");
      expect(video.views).toBe(900);
    });

    it("erro da meta (conta pessoal/restrita) marca api_indisponivel_em e cai para o apify na mesma tentativa", async () => {
      config.coleta.metaAtivo = true;
      const contaId = await criarContaComVideo("instagram", "conta-meta-indisponivel", 100);

      vi.mocked(buscarBusinessDiscovery).mockRejectedValue(new ErroMetaApi("conta pessoal", 100, 33));
      vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

      const resumo = await rodarContasBase();

      expect(resumo.contasProcessadas).toBe(1);
      expect(buscarInstagram).toHaveBeenCalledTimes(1);

      const [linha] = await db().select().from(contas).where(eq(contas.id, contaId));
      expect(linha.apiIndisponivelEm).not.toBeNull();
    });

    it("conta ja marcada api_indisponivel_em nunca tenta a meta de novo, vai direto pro apify", async () => {
      config.coleta.metaAtivo = true;
      await criarContaComVideo("instagram", "conta-ja-indisponivel", 100, { apiIndisponivelEm: new Date() });

      vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

      await rodarContasBase();

      expect(buscarBusinessDiscovery).not.toHaveBeenCalled();
      expect(buscarInstagram).toHaveBeenCalledTimes(1);
    });

    it("sem meta ativo, continua usando o apify como antes", async () => {
      await criarContaComVideo("instagram", "conta-sem-meta-ativo", 100);
      vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

      await rodarContasBase();

      expect(buscarBusinessDiscovery).not.toHaveBeenCalled();
      expect(buscarInstagram).toHaveBeenCalledTimes(1);
    });

    it("com meta ativo, o teto diario do apify nao trava uma candidata do instagram (ela nao usa apify)", async () => {
      config.coleta.metaAtivo = true;
      const contaInstagram = await criarContaComVideo("instagram", "conta-meta-sem-teto", 100);

      const teto = config.coleta.apifyMaxResultadosDia;
      await db().insert(consumoApi).values({ fonte: "apify", data: hojeISO(), unidades: teto });

      vi.mocked(buscarBusinessDiscovery).mockResolvedValue({ username: "conta-meta-sem-teto" });

      const resumo = await rodarContasBase();

      expect(resumo.tetoAtingido).toBe(false);
      const [linha] = await db().select().from(contas).where(eq(contas.id, contaInstagram));
      expect(linha.baseCompletaEm).not.toBeNull();
    });
  });
});
