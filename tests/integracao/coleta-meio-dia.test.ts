/**
 * `coleta-meio-dia` (E6 parte 3, terceira rodada, item 6) contra o Postgres
 * real, com o Apify mockado: so as contas vigiadas do TikTok, ordenadas por
 * taxa_fora_da_curva, ate `CONTAS_DA_PASSADA`; grava o video na conta certa
 * (por handle, sem `upsertConta`, a conta ja existe); chama
 * `rodarPontuarVelocidade` no fim.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, execucoesJob, nichos, videos } from "@/db/schema";
import type { TiktokItemBruto } from "@/jobs/apify-api";
import { rodarColetaMeioDia } from "@/jobs/coleta-meio-dia";
import { hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarTiktokVigilancia: vi.fn() };
});

// eslint-disable-next-line import/order -- vi.mock acima e hoisted; este import precisa vir depois para pegar o mock.
import { buscarTiktokVigilancia } from "@/jobs/apify-api";

function itemTiktok(handle: string, videoId: string, diasAtras: number): TiktokItemBruto {
  return {
    id: videoId,
    text: `[exemplo] video de ${handle}`,
    webVideoUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
    createTimeISO: new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000).toISOString(),
    authorMeta: { name: handle, nickName: handle },
    playCount: 720, // com 3 dias: 720/72h = 10 views/h
  };
}

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "coleta-meio-dia-teste", nome: "Coleta meio-dia teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(buscarTiktokVigilancia).mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  await db().delete(consumoApi);
});

describe("rodarColetaMeioDia", () => {
  it("busca so as contas vigiadas do tiktok, mais fora da curva primeiro, 5 videos cada", async () => {
    await db()
      .insert(contas)
      .values([
        { plataforma: "tiktok", handle: "conta-alta", nichoId, vigiada: true, taxaForaDaCurva: "0.8" },
        { plataforma: "tiktok", handle: "conta-media", nichoId, vigiada: true, taxaForaDaCurva: "0.4" },
        { plataforma: "tiktok", handle: "conta-nao-vigiada", nichoId, vigiada: false, taxaForaDaCurva: "0.9" },
        { plataforma: "instagram", handle: "conta-instagram", nichoId, vigiada: true, taxaForaDaCurva: "0.9" },
      ]);

    vi.mocked(buscarTiktokVigilancia).mockResolvedValue({ itens: [], devolvidos: 0 });

    await rodarColetaMeioDia();

    expect(buscarTiktokVigilancia).toHaveBeenCalledWith(["conta-alta", "conta-media"], 5, 10);
  });

  it("grava o video na conta certa (por handle) e com o execucaoId, sem duplicar a conta", async () => {
    await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-alta", nichoId, vigiada: true });
    const [execucao] = await db().insert(execucoesJob).values({ nome: "coleta-meio-dia" }).returning();

    vi.mocked(buscarTiktokVigilancia).mockResolvedValue({
      itens: [itemTiktok("conta-alta", "video-meio-dia-1", 3)],
      devolvidos: 1,
    });

    const resumo = await rodarColetaMeioDia(execucao.id);
    expect(resumo.videosNovos).toBe(1);

    const contasComHandle = await db().select().from(contas).where(eq(contas.handle, "conta-alta"));
    expect(contasComHandle).toHaveLength(1); // nao duplicou a conta

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-meio-dia-1"));
    expect(video.execucaoId).toBe(execucao.id);
    expect(video.nichoId).toBe(nichoId);
  });

  it("depois da coleta, roda so a velocidade (rodarPontuarVelocidade): o video novo recebe velocidade", async () => {
    await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-alta", nichoId, vigiada: true });

    vi.mocked(buscarTiktokVigilancia).mockResolvedValue({
      itens: [itemTiktok("conta-alta", "video-veloz", 3)], // 3 dias: dentro da janela de velocidade (2 a 7)
      devolvidos: 1,
    });

    const resumo = await rodarColetaMeioDia();
    expect(resumo.videosComVelocidade).toBeGreaterThan(0);

    const [video] = await db().select().from(videos).where(eq(videos.idExterno, "video-veloz"));
    expect(Number(video.velocidade)).toBeCloseTo(10, 3);
    // Sem mediana_views ainda (rodarPontuarVelocidade nao roda os passos 1/2/5).
    expect(video.foraDaCurva).toBeNull();
  });

  it("registra o consumo em consumo_api com fonte apify", async () => {
    await db().insert(contas).values({ plataforma: "tiktok", handle: "conta-alta", nichoId, vigiada: true });

    vi.mocked(buscarTiktokVigilancia).mockResolvedValue({
      itens: [itemTiktok("conta-alta", "video-consumo", 3)],
      devolvidos: 5,
    });

    const resumo = await rodarColetaMeioDia();
    expect(resumo.resultadosDevolvidos).toBe(5);
    expect(resumo.resultadosConsumidos).toBe(1);

    const [linha] = await db()
      .select()
      .from(consumoApi)
      .where(and(eq(consumoApi.fonte, "apify"), eq(consumoApi.data, hojeISO())));
    expect(linha.unidades).toBe(1);
  });

  it("sem conta vigiada do tiktok, recusa sem chamar o apify", async () => {
    await expect(rodarColetaMeioDia()).rejects.toThrow(/nenhuma conta vigiada/);
    expect(buscarTiktokVigilancia).not.toHaveBeenCalled();
  });
});
