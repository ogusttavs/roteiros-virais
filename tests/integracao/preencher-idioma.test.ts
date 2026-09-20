/**
 * `scripts/preencher-idioma.ts` contra o Postgres real (V2b, item 5):
 * detecta o idioma dos vídeos sem `idioma` por título/descrição, depois
 * roda o item 4 (`idioma_principal` e `pais` por conta), e a contagem
 * final por idioma e por plataforma bate com o que foi gravado.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";

import { preencherIdioma } from "../../scripts/preencher-idioma";
import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "preencher-idioma-teste", nome: "Preencher idioma teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos);
  await db().delete(contas);
});

describe("preencherIdioma", () => {
  it("detecta por titulo os videos sem idioma, e sem sinal fica nulo sem travar o script", async () => {
    const conta = await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: "@preencher-teste", nichoId })
      .returning()
      .then(([c]) => c.id);

    await db()
      .insert(videos)
      .values([
        {
          plataforma: "youtube",
          idExterno: "pt-1",
          url: "https://x/pt-1",
          contaId: conta,
          nichoId,
          titulo: "você não vai acreditar no que aconteceu",
        },
        {
          plataforma: "youtube",
          idExterno: "en-1",
          url: "https://x/en-1",
          contaId: conta,
          nichoId,
          titulo: "you won't believe what happened next",
        },
        {
          plataforma: "youtube",
          idExterno: "sem-sinal",
          url: "https://x/sem-sinal",
          contaId: conta,
          nichoId,
          titulo: "",
          descricao: "",
        },
        // Ja tinha idioma gravado (pela extracao, por exemplo): nunca e tocado.
        {
          plataforma: "youtube",
          idExterno: "ja-tinha",
          url: "https://x/ja-tinha",
          contaId: conta,
          nichoId,
          titulo: "titulo qualquer",
          idioma: "pt-BR",
        },
      ]);

    const resultado = await preencherIdioma();

    expect(resultado.videosSemIdiomaAntes).toBe(3);
    expect(resultado.videosAtualizadosPorTitulo).toBe(2);

    const linhas = await db().select().from(videos).orderBy(videos.idExterno);
    const idiomaPorId = new Map(linhas.map((l) => [l.idExterno, l.idioma]));
    expect(idiomaPorId.get("pt-1")).toBe("pt");
    expect(idiomaPorId.get("en-1")).toBe("en");
    expect(idiomaPorId.get("sem-sinal")).toBeNull();
    expect(idiomaPorId.get("ja-tinha")).toBe("pt-BR");
  });

  it("depois de detectar, roda idioma_principal e pais por conta (item 4)", async () => {
    const conta = await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: "@preencher-conta-teste", nichoId })
      .returning()
      .then(([c]) => c.id);

    for (let i = 0; i < 3; i += 1) {
      await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `conta-teste-${i}`,
          url: `https://x/conta-teste-${i}`,
          contaId: conta,
          nichoId,
          publicadoEm: new Date(),
          titulo: "aceita pix e cobra em reais, direto de sao paulo",
        });
    }

    await preencherIdioma();

    const [linha] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(linha.idiomaPrincipal).toBe("pt");
    expect(linha.pais).toBe("BR");
  });

  it("idempotente: rodar duas vezes seguidas nao muda o resultado nem trava", async () => {
    const conta = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "idempotente-teste", nichoId })
      .returning()
      .then(([c]) => c.id);

    await db()
      .insert(videos)
      .values({
        plataforma: "tiktok",
        idExterno: "idempotente-1",
        url: "https://x/idempotente-1",
        contaId: conta,
        nichoId,
        titulo: "você não vai acreditar",
      });

    const primeira = await preencherIdioma();
    const segunda = await preencherIdioma();

    expect(primeira.videosAtualizadosPorTitulo).toBe(1);
    expect(segunda.videosAtualizadosPorTitulo).toBe(0);

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "idempotente-1"));
    expect(linha.idioma).toBe("pt");
  });

  it("a contagem final por plataforma bate com o que foi gravado", async () => {
    const contaYoutube = await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: "@contagem-youtube", nichoId })
      .returning()
      .then(([c]) => c.id);
    const contaTiktok = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "contagem-tiktok", nichoId })
      .returning()
      .then(([c]) => c.id);

    await db()
      .insert(videos)
      .values([
        { plataforma: "youtube", idExterno: "cont-yt-1", url: "https://x/cont-yt-1", contaId: contaYoutube, nichoId, titulo: "você não vai acreditar" },
        { plataforma: "youtube", idExterno: "cont-yt-2", url: "https://x/cont-yt-2", contaId: contaYoutube, nichoId, titulo: "you won't believe this" },
        { plataforma: "tiktok", idExterno: "cont-tt-1", url: "https://x/cont-tt-1", contaId: contaTiktok, nichoId, titulo: "você não vai acreditar" },
      ]);

    const resultado = await preencherIdioma();

    expect(resultado.contagemPorPlataforma.youtube.pt).toBe(1);
    expect(resultado.contagemPorPlataforma.youtube.en).toBe(1);
    expect(resultado.contagemPorPlataforma.tiktok.pt).toBe(1);
  });
});
