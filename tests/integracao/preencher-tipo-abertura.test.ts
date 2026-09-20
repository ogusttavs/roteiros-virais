/**
 * `scripts/preencher-tipo-abertura.ts` contra o Postgres real (V4, item 2):
 * classifica pelo gancho e pelo formato os vídeos que já têm análise e
 * ainda não têm tipo de abertura, em mock (`AI_PROVIDER=mock`,
 * `vitest.config.mts`, `mockClassificarAbertura`).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos, type AnaliseVideo } from "@/db/schema";

import { preencherTipoAbertura } from "../../scripts/preencher-tipo-abertura";
import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

function analise(gancho: string, formato: AnaliseVideo["formato"] = "fala_para_camera"): AnaliseVideo {
  return {
    assunto: "assunto do teste",
    gancho,
    estrutura: "gancho, demonstracao, fechamento",
    fechamento: "mostra o resultado",
    chamadaFinal: "comenta se voce ja passou por isso",
    formato,
    porQueFuncionou: "mostra o problema acontecendo de verdade",
  };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "preencher-abertura-teste", nome: "Preencher abertura teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("preencherTipoAbertura", () => {
  it("classifica pelo gancho (mock: pergunta com '?', numero com digito, senao cena) so quem tem analise e nao tem tipo", async () => {
    await db()
      .insert(videos)
      .values([
        {
          plataforma: "youtube",
          idExterno: "pergunta-1",
          url: "https://x/pergunta-1",
          nichoId,
          analise: analise("voce ja errou desse jeito?") as never,
        },
        {
          plataforma: "youtube",
          idExterno: "numero-1",
          url: "https://x/numero-1",
          nichoId,
          analise: analise("3 erros que estragam o sofa") as never,
        },
        {
          plataforma: "youtube",
          idExterno: "cena-1",
          url: "https://x/cena-1",
          nichoId,
          analise: analise("olha essa mancha saindo") as never,
        },
        // sem analise ainda: nunca entra no backfill.
        {
          plataforma: "youtube",
          idExterno: "sem-analise",
          url: "https://x/sem-analise",
          nichoId,
        },
        // ja tinha tipo (extracao normal, por exemplo): nunca e tocado de novo.
        {
          plataforma: "youtube",
          idExterno: "ja-tinha-tipo",
          url: "https://x/ja-tinha-tipo",
          nichoId,
          analise: analise("qualquer gancho") as never,
          tipoAbertura: "outro",
        },
      ]);

    const resultado = await preencherTipoAbertura();

    expect(resultado.videosSemTipoAberturaAntes).toBe(3);
    expect(resultado.videosAtualizados).toBe(3);
    expect(resultado.videosComErro).toBe(0);

    const linhas = await db().select().from(videos).orderBy(videos.idExterno);
    const tipoPorId = new Map(linhas.map((l) => [l.idExterno, l.tipoAbertura]));
    expect(tipoPorId.get("pergunta-1")).toBe("pergunta");
    expect(tipoPorId.get("numero-1")).toBe("numero");
    expect(tipoPorId.get("cena-1")).toBe("cena");
    expect(tipoPorId.get("sem-analise")).toBeNull();
    expect(tipoPorId.get("ja-tinha-tipo")).toBe("outro");
  });

  it("idempotente: rodar duas vezes seguidas nao muda nada na segunda", async () => {
    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "idempotente-1",
        url: "https://x/idempotente-1",
        nichoId,
        analise: analise("olha essa mancha saindo") as never,
      });

    const primeira = await preencherTipoAbertura();
    const segunda = await preencherTipoAbertura();

    expect(primeira.videosAtualizados).toBe(1);
    expect(segunda.videosAtualizados).toBe(0);

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "idempotente-1"));
    expect(video.tipoAbertura).toBe("cena");
  });

  it("--limite corta a quantidade processada nesta rodada", async () => {
    await db()
      .insert(videos)
      .values([
        { plataforma: "youtube", idExterno: "limite-1", url: "https://x/limite-1", nichoId, analise: analise("um") as never },
        { plataforma: "youtube", idExterno: "limite-2", url: "https://x/limite-2", nichoId, analise: analise("dois") as never },
        { plataforma: "youtube", idExterno: "limite-3", url: "https://x/limite-3", nichoId, analise: analise("tres") as never },
      ]);

    const resultado = await preencherTipoAbertura(2);

    expect(resultado.videosAtualizados).toBe(2);
    expect(resultado.videosSemTipoAberturaAntes).toBe(3);
  });
});
