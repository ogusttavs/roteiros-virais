/**
 * `upsertVideo` (revisao da etapa 6, parte 2): uma recoleta cujo ator nao
 * devolveu audio nao pode apagar o audio ja gravado numa coleta anterior.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos } from "@/db/schema";

import { resetarSchema } from "../../scripts/resetar-schema";
import { upsertConta, upsertVideo, type VideoParaGravar } from "../../src/jobs/coleta-comum";

let nichoId: number;

const videoBase: VideoParaGravar = {
  plataforma: "tiktok",
  idExterno: "coleta-comum-teste-video",
  url: "https://www.tiktok.com/@exemplo/video/coleta-comum-teste-video",
  titulo: null,
  descricao: null,
  publicadoEm: null,
  duracaoS: null,
  views: 100,
  likes: 10,
  comentarios: 1,
};

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "coleta-comum-teste", nome: "Coleta comum teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("upsertVideo", () => {
  it("uma recoleta sem audio nao apaga o audio ja gravado", async () => {
    const contaId = await upsertConta(
      { plataforma: "tiktok", handle: "exemplo.coletacomum", nome: null, url: null },
      nichoId,
    );

    await upsertVideo(videoBase, contaId, nichoId, {
      id: "musica-1",
      nome: "som original",
      autor: "exemplo.coletacomum",
      original: true,
    });

    await upsertVideo({ ...videoBase, views: 200 }, contaId, nichoId, null);

    const [linha] = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "tiktok"), eq(videos.idExterno, videoBase.idExterno)));

    expect(linha.views).toBe(200);
    expect(linha.audio).toEqual({
      id: "musica-1",
      nome: "som original",
      autor: "exemplo.coletacomum",
      original: true,
    });
  });
});
