/**
 * `scripts/corrigir-titulos.ts` contra o Postgres real (`PROXIMO.md`, E6
 * parte 3, item 3): video do TikTok ou do Instagram com `titulo` nulo recebe
 * a primeira linha da descricao, ou "vídeo de @conta, data por extenso" sem
 * descricao nenhuma. Idempotente: rodar de novo nao muda nada, e video do
 * YouTube (que ja vem com titulo de verdade) nunca e tocado.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";

import { corrigirTitulos } from "../../scripts/corrigir-titulos";
import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

async function criarConta(plataforma: "tiktok" | "instagram" | "youtube", handle: string): Promise<number> {
  const [c] = await db().insert(contas).values({ plataforma, handle, nichoId }).returning({ id: contas.id });
  return c.id;
}

async function criarVideo(
  contaId: number,
  idExterno: string,
  dados: { plataforma: "tiktok" | "instagram" | "youtube"; descricao?: string | null; publicadoEm?: Date | null; titulo?: string | null },
) {
  await db()
    .insert(videos)
    .values({
      plataforma: dados.plataforma,
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId,
      nichoId,
      titulo: dados.titulo ?? null,
      descricao: dados.descricao ?? null,
      publicadoEm: dados.publicadoEm ?? null,
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "corrigir-titulos-teste", nome: "Corrigir titulos teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
});

describe("corrigirTitulos", () => {
  it("preenche o titulo do tiktok e do instagram com a primeira linha da descricao", async () => {
    const contaTiktok = await criarConta("tiktok", "sorrisoemdia");
    await criarVideo(contaTiktok, "tk-com-descricao", {
      plataforma: "tiktok",
      descricao: "3 erros que estragam o seu sorriso\n#dentista",
    });

    const contaInstagram = await criarConta("instagram", "clareamentofacil");
    await criarVideo(contaInstagram, "ig-com-descricao", {
      plataforma: "instagram",
      descricao: "antes e depois de um clareamento",
    });

    const resultado = await corrigirTitulos();
    expect(resultado).toEqual({ videosSemTitulo: 2, videosCorrigidos: 2 });

    const [vTiktok] = await db().select().from(videos).where(eq(videos.idExterno, "tk-com-descricao"));
    expect(vTiktok.titulo).toBe("3 erros que estragam o seu sorriso");

    const [vInstagram] = await db().select().from(videos).where(eq(videos.idExterno, "ig-com-descricao"));
    expect(vInstagram.titulo).toBe("antes e depois de um clareamento");
  });

  it("sem descricao, usa vídeo de @conta e a data por extenso", async () => {
    const contaTiktok = await criarConta("tiktok", "semlegenda");
    await criarVideo(contaTiktok, "tk-sem-descricao", {
      plataforma: "tiktok",
      descricao: null,
      publicadoEm: new Date("2026-09-05T12:00:00Z"),
    });

    await corrigirTitulos();

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "tk-sem-descricao"));
    expect(video.titulo).toBe("vídeo de @semlegenda, 5 de setembro");
  });

  it("nunca toca video do youtube (ja vem com titulo de verdade) nem video que ja tem titulo", async () => {
    const contaYoutube = await criarConta("youtube", "UCexemplo0000000001");
    await criarVideo(contaYoutube, "yt-sem-titulo", { plataforma: "youtube", descricao: "descricao qualquer" });

    const contaTiktok = await criarConta("tiktok", "jatemtitulo");
    await criarVideo(contaTiktok, "tk-ja-tem-titulo", {
      plataforma: "tiktok",
      descricao: "outra coisa",
      titulo: "titulo que ja existia",
    });

    const resultado = await corrigirTitulos();
    expect(resultado).toEqual({ videosSemTitulo: 0, videosCorrigidos: 0 });

    const [vYoutube] = await db().select().from(videos).where(eq(videos.idExterno, "yt-sem-titulo"));
    expect(vYoutube.titulo).toBeNull();
    const [vTiktok] = await db().select().from(videos).where(eq(videos.idExterno, "tk-ja-tem-titulo"));
    expect(vTiktok.titulo).toBe("titulo que ja existia");
  });

  it("idempotente: rodar duas vezes na mesma base nao muda nada na segunda", async () => {
    const conta = await criarConta("tiktok", "idempotente");
    await criarVideo(conta, "tk-idempotente", { plataforma: "tiktok", descricao: "titulo original" });

    const primeira = await corrigirTitulos();
    expect(primeira.videosCorrigidos).toBe(1);

    const segunda = await corrigirTitulos();
    expect(segunda).toEqual({ videosSemTitulo: 0, videosCorrigidos: 0 });

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "tk-idempotente"));
    expect(video.titulo).toBe("titulo original");
  });
});
