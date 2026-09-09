/**
 * `nichoPorSlug`, `listarContasVigiadas` e `statusMetaApi` (etapa 7; a
 * origem, ultima leitura e o status da Meta, E6 parte 3, segunda rodada,
 * item 5): a base de `/admin/nichos/[slug]`.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, hashtagsMetaUsadas, nichos } from "@/db/schema";
import { config } from "@/lib/config";
import { listarContasVigiadas, nichoPorSlug, statusMetaApi } from "@/servicos/admin-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "admin-pontuacao-teste", nome: "Admin pontuacao teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("nichoPorSlug", () => {
  it("acha o nicho pelo slug e devolve nulo quando nao existe", async () => {
    const achado = await nichoPorSlug("admin-pontuacao-teste");
    expect(achado?.id).toBe(nichoId);
    expect(await nichoPorSlug("slug-que-nao-existe")).toBeNull();
  });
});

describe("listarContasVigiadas", () => {
  it("so traz conta vigiada do nicho pedido, ordenada por taxa desc", async () => {
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "vig-alta", nichoId, vigiada: true, taxaForaDaCurva: "0.8" });
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "vig-baixa", nichoId, vigiada: true, taxaForaDaCurva: "0.2" });
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "nao-vigiada", nichoId, vigiada: false, taxaForaDaCurva: "0.99" });

    const outroNicho = await db()
      .insert(nichos)
      .values({ slug: "admin-pontuacao-teste-2", nome: "Outro", termos: [] })
      .returning();
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "outro-nicho", nichoId: outroNicho[0].id, vigiada: true, taxaForaDaCurva: "1" });

    const resultado = await listarContasVigiadas(nichoId);
    expect(resultado.map((c) => c.handle)).toEqual(["vig-alta", "vig-baixa"]);
    expect(resultado[0].taxaForaDaCurva).toBeCloseTo(0.8, 3);
  });

  it("origemInstagram e null para youtube/tiktok; api ou apify conforme metaAtivo e api_indisponivel_em", async () => {
    config.coleta.metaAtivo = true;
    try {
      await db()
        .insert(contas)
        .values([
          { plataforma: "youtube", handle: "yt-vigiada", nichoId, vigiada: true },
          { plataforma: "instagram", handle: "ig-coberta-pela-api", nichoId, vigiada: true, ultimaLeituraMetaEm: new Date() },
          { plataforma: "instagram", handle: "ig-indisponivel", nichoId, vigiada: true, apiIndisponivelEm: new Date() },
        ]);

      const resultado = await listarContasVigiadas(nichoId);
      const porHandle = new Map(resultado.map((c) => [c.handle, c]));

      expect(porHandle.get("yt-vigiada")?.origemInstagram).toBeNull();
      expect(porHandle.get("ig-coberta-pela-api")?.origemInstagram).toBe("api");
      expect(porHandle.get("ig-coberta-pela-api")?.ultimaLeituraMetaEm).not.toBeNull();
      expect(porHandle.get("ig-indisponivel")?.origemInstagram).toBe("apify");
    } finally {
      config.coleta.metaAtivo = false;
      await db().delete(contas).where(eq(contas.nichoId, nichoId));
    }
  });

  it("com metaAtivo desligado, toda conta do instagram e apify, mesmo sem api_indisponivel_em", async () => {
    await db().insert(contas).values({ plataforma: "instagram", handle: "ig-sem-meta", nichoId, vigiada: true });
    try {
      const resultado = await listarContasVigiadas(nichoId);
      expect(resultado.find((c) => c.handle === "ig-sem-meta")?.origemInstagram).toBe("apify");
    } finally {
      await db().delete(contas).where(eq(contas.nichoId, nichoId));
    }
  });
});

describe("statusMetaApi", () => {
  afterEach(async () => {
    await db().delete(hashtagsMetaUsadas);
  });

  it("conta chamadas da ultima hora e hashtags dos ultimos 7 dias, contra os limites da meta", async () => {
    await db()
      .insert(hashtagsMetaUsadas)
      .values([
        { termo: "termo-recente", hashtagId: "h1", ultimoUsoEm: new Date() },
        { termo: "termo-velho", hashtagId: "h2", ultimoUsoEm: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      ]);

    const status = await statusMetaApi();

    expect(status.hashtagsNaSemana).toBe(1);
    expect(status.limiteHashtagsSemana).toBe(30);
    expect(status.limiteChamadasHora).toBe(200);
    expect(status.chamadasNaHora).toBeGreaterThanOrEqual(0);
  });
});
