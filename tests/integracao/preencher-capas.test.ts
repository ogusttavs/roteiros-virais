/**
 * `scripts/preencher-capas.ts` contra o Postgres real (V9d, item 0b,
 * sub-item 4): so o YouTube preenche neste backfill (monta por codigo, sem
 * chamada nenhuma); Instagram e TikTok ficam de fora, decisao registrada no
 * proprio script e em TODO.md.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos } from "@/db/schema";

import { preencherCapas } from "../../scripts/preencher-capas";
import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "preencher-capas-teste", nome: "Preencher capas teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("preencherCapas", () => {
  it("preenche a capa do youtube pelo id externo, e nunca mexe em video que ja tem capa", async () => {
    await db()
      .insert(videos)
      .values([
        {
          plataforma: "youtube",
          idExterno: "backfill-youtube-1",
          url: "https://x/backfill-youtube-1",
          nichoId,
        },
        {
          plataforma: "youtube",
          idExterno: "backfill-youtube-2",
          url: "https://x/backfill-youtube-2",
          nichoId,
          capaUrl: "https://exemplo.invalido/ja-tinha.jpg",
        },
      ]);

    const resultado = await preencherCapas();
    expect(resultado.videosDoYoutubeAtualizados).toBe(1);

    const linhas = await db().select().from(videos).where(eq(videos.nichoId, nichoId));
    const semCapaAntes = linhas.find((v) => v.idExterno === "backfill-youtube-1");
    const jaTinhaCapa = linhas.find((v) => v.idExterno === "backfill-youtube-2");

    expect(semCapaAntes?.capaUrl).toBe("https://i.ytimg.com/vi/backfill-youtube-1/hqdefault.jpg");
    expect(jaTinhaCapa?.capaUrl).toBe("https://exemplo.invalido/ja-tinha.jpg");
  });

  it("instagram e tiktok ficam sem capa neste backfill (decisao registrada, sem chamada nova a plataforma)", async () => {
    await db()
      .insert(videos)
      .values([
        { plataforma: "instagram", idExterno: "backfill-instagram-1", url: "https://x/backfill-instagram-1", nichoId },
        { plataforma: "tiktok", idExterno: "backfill-tiktok-1", url: "https://x/backfill-tiktok-1", nichoId },
      ]);

    await preencherCapas();

    const linhas = await db().select().from(videos).where(eq(videos.nichoId, nichoId));
    expect(linhas.every((v) => v.capaUrl === null)).toBe(true);
  });

  it("idempotente: rodar duas vezes nao muda o resultado", async () => {
    await db()
      .insert(videos)
      .values({ plataforma: "youtube", idExterno: "backfill-youtube-3", url: "https://x/backfill-youtube-3", nichoId });

    await preencherCapas();
    const segundaRodada = await preencherCapas();

    expect(segundaRodada.videosDoYoutubeAtualizados).toBe(0);
  });
});
