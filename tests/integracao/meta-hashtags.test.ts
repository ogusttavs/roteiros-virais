/**
 * Job `meta-hashtags` (E6 parte 3, segunda rodada, item 3, ajuste 2 da
 * revisao do PR #35) contra o Postgres real: resolve hashtags, le o
 * `recent_media`, filtra por tipo (so vira video um `VIDEO` ou `REELS`) e
 * por indicio de Brasil, grava video sem dono, transcreve o video novo na
 * hora quando tem `media_url` (media_url expira, e nem todo item tem um),
 * e respeita o limite de 30 hashtags unicas por semana.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/jobs/meta-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/meta-api")>();
  return { ...original, buscarIdDaHashtag: vi.fn(), buscarRecentMediaDaHashtag: vi.fn() };
});
vi.mock("@/jobs/audio", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/audio")>();
  return { ...original, baixarAudio: vi.fn(), apagarAudio: vi.fn() };
});
vi.mock("@/jobs/groq-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/groq-api")>();
  return { ...original, transcreverAudio: vi.fn() };
});
vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      coleta: { ...original.config.coleta, metaAtivo: true },
      transcricao: { ...original.config.transcricao, groqKey: "chave-de-teste" },
    },
  };
});

import { db, getPool } from "@/db";
import { hashtagsMetaUsadas, nichos, videos } from "@/db/schema";
import { apagarAudio, baixarAudio } from "@/jobs/audio";
import { ErroColeta } from "@/jobs/execucoes";
import { transcreverAudio } from "@/jobs/groq-api";
import { buscarIdDaHashtag, buscarRecentMediaDaHashtag, ErroMetaApi } from "@/jobs/meta-api";
import { rodarMetaHashtags } from "@/jobs/meta-hashtags";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "meta-hashtags-teste", nome: "Meta hashtags teste", termos: ["limpeza"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(buscarIdDaHashtag).mockReset();
  vi.mocked(buscarRecentMediaDaHashtag).mockReset();
  vi.mocked(baixarAudio).mockReset().mockResolvedValue("/tmp/audio-fake.mp3");
  vi.mocked(apagarAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(transcreverAudio).mockReset().mockResolvedValue("[exemplo] transcricao fake");
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(hashtagsMetaUsadas);
});

describe("rodarMetaHashtags", () => {
  it("sem META_ATIVO, recusa rodar", async () => {
    config.coleta.metaAtivo = false;
    try {
      await expect(rodarMetaHashtags()).rejects.toThrow(ErroColeta);
    } finally {
      config.coleta.metaAtivo = true;
    }
  });

  it("resolve a hashtag, filtra por tipo e por indicio de Brasil, grava so o que passa, sem conta dona, e transcreve o novo", async () => {
    vi.mocked(buscarIdDaHashtag).mockResolvedValue("17841563347091627");
    vi.mocked(buscarRecentMediaDaHashtag).mockResolvedValue([
      {
        id: "1",
        caption: "Dica de limpeza para quem mora em São Paulo #brasil",
        media_type: "VIDEO",
        media_product_type: "REELS",
        media_url: "https://exemplo.invalido/video1.mp4",
        permalink: "https://www.instagram.com/p/ExemploBrasil01/",
        timestamp: "2026-08-19T10:00:00.000Z",
        like_count: 100,
        comments_count: 5,
      },
      {
        id: "2",
        caption: "Cleaning tips for your home",
        media_type: "VIDEO",
        media_product_type: "REELS",
        permalink: "https://www.instagram.com/p/ExemploIngles01/",
        timestamp: "2026-08-19T10:00:00.000Z",
        like_count: 50,
        comments_count: 2,
      },
      /** Achado real do Fable, 09/09/2026: a maioria do top_media da hashtag "limpeza" era IMAGE/CAROUSEL_ALBUM, nunca VIDEO. */
      {
        id: "3",
        caption: "Foto de produto de limpeza #brasil",
        media_type: "IMAGE",
        permalink: "https://www.instagram.com/p/ExemploFoto01/",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
      {
        id: "4",
        caption: "Carrossel de dicas de limpeza #brasil",
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://www.instagram.com/p/ExemploCarrossel01/",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
    ]);

    const resumo = await rodarMetaHashtags();

    expect(resumo.videosNovos).toBe(1);
    expect(resumo.itensNaoVideo).toBe(2);
    expect(resumo.transcritos).toBe(1);

    const [videoBrasil] = await db().select().from(videos).where(eq(videos.idExterno, "ExemploBrasil01"));
    expect(videoBrasil).toBeDefined();
    expect(videoBrasil.contaId).toBeNull();
    expect(videoBrasil.semDono).toBe(true);
    expect(videoBrasil.origem).toBe("meta");
    expect(videoBrasil.transcricao).toBe("[exemplo] transcricao fake");

    const videoIngles = await db().select().from(videos).where(eq(videos.idExterno, "ExemploIngles01"));
    expect(videoIngles).toHaveLength(0);

    const foto = await db().select().from(videos).where(eq(videos.idExterno, "ExemploFoto01"));
    expect(foto).toHaveLength(0);
    const carrossel = await db().select().from(videos).where(eq(videos.idExterno, "ExemploCarrossel01"));
    expect(carrossel).toHaveLength(0);

    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/video1.mp4");
    expect(apagarAudio).toHaveBeenCalledWith("/tmp/audio-fake.mp3");
  });

  /** Ajuste 2 (c) da revisao do PR #35: achado real, 21 dos 38 VIDEO do recent_media nao tinham media_url. */
  it("video novo sem media_url vira linha sem transcricao e sem erro, contado em semMediaUrl", async () => {
    vi.mocked(buscarIdDaHashtag).mockResolvedValue("17841563347091627");
    vi.mocked(buscarRecentMediaDaHashtag).mockResolvedValue([
      {
        id: "5",
        caption: "Dica de limpeza sem media_url #brasil",
        media_type: "VIDEO",
        media_product_type: "REELS",
        permalink: "https://www.instagram.com/p/ExemploSemUrl01/",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
    ]);

    const resumo = await rodarMetaHashtags();

    expect(resumo.videosNovos).toBe(1);
    expect(resumo.semMediaUrl).toBe(1);
    expect(resumo.transcritos).toBe(0);
    expect(resumo.erros).toBeUndefined();

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "ExemploSemUrl01"));
    expect(video.transcricao).toBeNull();
    expect(baixarAudio).not.toHaveBeenCalled();
  });

  it("uma hashtag ja resolvida nos ultimos 7 dias nao chama buscarIdDaHashtag de novo", async () => {
    await db().insert(hashtagsMetaUsadas).values({ termo: "limpeza", hashtagId: "hashtag-ja-resolvida" });

    vi.mocked(buscarRecentMediaDaHashtag).mockResolvedValue([]);

    await rodarMetaHashtags();

    expect(buscarIdDaHashtag).not.toHaveBeenCalled();
    expect(buscarRecentMediaDaHashtag).toHaveBeenCalledWith("hashtag-ja-resolvida");
  });

  it("no limite de 30 hashtags da semana, um termo novo fica de fora (registrado, sem chamar a meta)", async () => {
    const jaUsadas = Array.from({ length: 30 }, (_, i) => ({ termo: `termo-${i}`, hashtagId: `hash-${i}` }));
    await db().insert(hashtagsMetaUsadas).values(jaUsadas);

    const resumo = await rodarMetaHashtags();

    expect(resumo.hashtagsForaDoLimite).toEqual(["limpeza"]);
    expect(buscarIdDaHashtag).not.toHaveBeenCalled();
  });

  it("video que ja existia (atualizado, nao novo) nao tenta transcrever de novo", async () => {
    await db().insert(videos).values({
      plataforma: "instagram",
      idExterno: "ExemploJaExistia01",
      url: "https://www.instagram.com/p/ExemploJaExistia01/",
      nichoId,
      semDono: true,
      origem: "meta",
      transcricao: "[exemplo] ja tinha transcricao",
    });

    vi.mocked(buscarIdDaHashtag).mockResolvedValue("hashtag-x");
    vi.mocked(buscarRecentMediaDaHashtag).mockResolvedValue([
      {
        id: "1",
        caption: "Dica de limpeza para quem mora em São Paulo #brasil",
        media_type: "VIDEO",
        media_product_type: "REELS",
        media_url: "https://exemplo.invalido/video1.mp4",
        permalink: "https://www.instagram.com/p/ExemploJaExistia01/",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
    ]);

    const resumo = await rodarMetaHashtags();

    expect(resumo.videosAtualizados).toBe(1);
    expect(resumo.videosNovos).toBe(0);
    expect(baixarAudio).not.toHaveBeenCalled();
  });

  it("normaliza o termo (espaco e acento) antes de resolver a hashtag na meta (achado do dia 1 da conferencia, 10/09/2026)", async () => {
    await db().update(nichos).set({ termos: ["mancha no sofá"] }).where(eq(nichos.id, nichoId));
    vi.mocked(buscarIdDaHashtag).mockResolvedValue("hashtag-mancha");
    vi.mocked(buscarRecentMediaDaHashtag).mockResolvedValue([]);

    try {
      await rodarMetaHashtags(nichoId);
      expect(buscarIdDaHashtag).toHaveBeenCalledWith("manchanosofa");

      const [linha] = await db().select().from(hashtagsMetaUsadas).where(eq(hashtagsMetaUsadas.termo, "mancha no sofá"));
      expect(linha.termo).toBe("mancha no sofá");
      expect(linha.hashtagId).toBe("hashtag-mancha");
    } finally {
      await db().update(nichos).set({ termos: ["limpeza"] }).where(eq(nichos.id, nichoId));
    }
  });

  it("hashtag que nao existe na meta conta em hashtagsInexistentes, nao em erros (achado do dia 1 da conferencia, 10/09/2026)", async () => {
    vi.mocked(buscarIdDaHashtag).mockResolvedValue(null);

    const resumo = await rodarMetaHashtags();

    expect(resumo.hashtagsInexistentes).toEqual(["limpeza"]);
    expect(resumo.erros).toBeUndefined();
    expect(buscarRecentMediaDaHashtag).not.toHaveBeenCalled();

    const linhas = await db().select().from(hashtagsMetaUsadas).where(eq(hashtagsMetaUsadas.termo, "limpeza"));
    expect(linhas).toHaveLength(0);
  });

  /**
   * Achado da prova do PR #38, 10/09/2026: a hashtag inexistente nao volta
   * vazia da Meta, ela lanca `code 24`/`error_subcode 2207024`. Corpo real
   * da chamada de leitura direta contra "limpezadepaineldecarro".
   */
  it("code 24 da meta (hashtag inexistente pelo erro cru) tambem conta em hashtagsInexistentes, nao em erros", async () => {
    vi.mocked(buscarIdDaHashtag).mockRejectedValue(
      new ErroMetaApi("The requested resource does not exist", 24, 2207024),
    );

    const resumo = await rodarMetaHashtags();

    expect(resumo.hashtagsInexistentes).toEqual(["limpeza"]);
    expect(resumo.erros).toBeUndefined();
    expect(buscarRecentMediaDaHashtag).not.toHaveBeenCalled();

    const linhas = await db().select().from(hashtagsMetaUsadas).where(eq(hashtagsMetaUsadas.termo, "limpeza"));
    expect(linhas).toHaveLength(0);
  });

  it("com nichoId, roda so para aquele nicho e so ate 8 termos", async () => {
    await db()
      .update(nichos)
      .set({ termos: Array.from({ length: 10 }, (_, i) => `termo-${i}`) })
      .where(eq(nichos.id, nichoId));

    vi.mocked(buscarIdDaHashtag).mockResolvedValue("hashtag-x");
    vi.mocked(buscarRecentMediaDaHashtag).mockResolvedValue([]);

    await rodarMetaHashtags(nichoId);

    expect(buscarIdDaHashtag).toHaveBeenCalledTimes(8);

    await db().update(nichos).set({ termos: ["limpeza"] }).where(eq(nichos.id, nichoId));
  });
});
