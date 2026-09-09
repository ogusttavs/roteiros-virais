/**
 * Job `meta-contas` (E6 parte 3, segunda rodada, item 2) contra o Postgres
 * real, com a Business Discovery mockada: busca, normaliza e grava video e
 * conta das contas vigiadas do Instagram; conta pessoal/restrita marca
 * `api_indisponivel_em`; sem `META_ATIVO`, recusa rodar.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/jobs/meta-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/meta-api")>();
  return { ...original, buscarBusinessDiscovery: vi.fn() };
});

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { ErroColeta } from "@/jobs/execucoes";
import { buscarBusinessDiscovery, ErroMetaApi } from "@/jobs/meta-api";
import { rodarMetaContas } from "@/jobs/meta-contas";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "meta-contas-teste", nome: "Meta contas teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(buscarBusinessDiscovery).mockReset();
  config.coleta.metaAtivo = true;
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  config.coleta.metaAtivo = false;
});

describe("rodarMetaContas", () => {
  it("sem META_ATIVO, recusa rodar (nao retentavel)", async () => {
    config.coleta.metaAtivo = false;
    await expect(rodarMetaContas()).rejects.toThrow(ErroColeta);
  });

  it("busca as contas vigiadas do instagram, normaliza e grava video e conta", async () => {
    const [conta] = await db()
      .insert(contas)
      .values({ plataforma: "instagram", handle: "conta-vigiada-meta", nichoId, vigiada: true })
      .returning();

    vi.mocked(buscarBusinessDiscovery).mockResolvedValue({
      username: "conta-vigiada-meta",
      followers_count: 12000,
      media: {
        data: [
          {
            id: "1",
            media_type: "VIDEO",
            timestamp: "2026-08-20T10:00:00.000Z",
            view_count: 5000,
            like_count: 200,
            comments_count: 10,
            permalink: "https://www.instagram.com/p/ExemploVigiada01/",
            caption: "[exemplo] video da conta vigiada",
          },
        ],
      },
    });

    const resumo = await rodarMetaContas();

    expect(resumo.contasLidas).toBe(1);
    expect(resumo.videosNovos).toBe(1);
    expect(resumo.viewsTotais).toBe(5000);

    const [linhaConta] = await db().select().from(contas).where(eq(contas.id, conta.id));
    expect(linhaConta.seguidores).toBe(12000);
    expect(linhaConta.ultimaLeituraMetaEm).not.toBeNull();

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "ExemploVigiada01"));
    expect(video.origem).toBe("meta");
  });

  it("conta pessoal ou restrita (erro da meta) marca api_indisponivel_em e entra em erros, sem derrubar o job", async () => {
    const [conta] = await db()
      .insert(contas)
      .values({ plataforma: "instagram", handle: "conta-pessoal-meta", nichoId, vigiada: true })
      .returning();

    vi.mocked(buscarBusinessDiscovery).mockRejectedValue(new ErroMetaApi("conta pessoal", 100, 33));

    const resumo = await rodarMetaContas();

    expect(resumo.contasLidas).toBe(0);
    expect((resumo.erros as string[] | undefined)?.[0]).toContain("conta-pessoal-meta");

    const [linha] = await db().select().from(contas).where(eq(contas.id, conta.id));
    expect(linha.apiIndisponivelEm).not.toBeNull();
  });

  it("conta ja marcada api_indisponivel_em nunca e tentada de novo", async () => {
    await db()
      .insert(contas)
      .values({
        plataforma: "instagram",
        handle: "conta-ja-indisponivel-meta",
        nichoId,
        vigiada: true,
        apiIndisponivelEm: new Date(),
      });

    const resumo = await rodarMetaContas();

    expect(resumo.contasLidas).toBe(0);
    expect(buscarBusinessDiscovery).not.toHaveBeenCalled();
  });

  it("conta nao vigiada nunca e lida", async () => {
    await db()
      .insert(contas)
      .values({ plataforma: "instagram", handle: "conta-nao-vigiada-meta", nichoId, vigiada: false });

    await rodarMetaContas();

    expect(buscarBusinessDiscovery).not.toHaveBeenCalled();
  });

  it("com nichoId, roda so para aquele nicho", async () => {
    const [outroNicho] = await db()
      .insert(nichos)
      .values({ slug: "meta-contas-outro", nome: "Meta contas outro", termos: [] })
      .returning();

    try {
      await db()
        .insert(contas)
        .values({ plataforma: "instagram", handle: "conta-outro-nicho-meta", nichoId: outroNicho.id, vigiada: true });

      const resumo = await rodarMetaContas(nichoId);
      expect(resumo.nichos).toBe(1);
      expect(buscarBusinessDiscovery).not.toHaveBeenCalled();
    } finally {
      await db().delete(contas).where(eq(contas.nichoId, outroNicho.id));
      await db().delete(nichos).where(eq(nichos.id, outroNicho.id));
    }
  });
});
