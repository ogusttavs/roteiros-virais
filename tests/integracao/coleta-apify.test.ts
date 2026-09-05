/**
 * Ciclo completo da coleta do Apify (TikTok e Instagram) contra o Postgres
 * real, com o cliente do Apify mockado (etapa 6, parte 2, criterio de
 * aceite): busca, normaliza e grava video, conta e audio; idempotencia
 * (rodar duas vezes atualiza em vez de duplicar); registra o consumo
 * combinado em consumo_api; para de chamar ao atingir o teto diario.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, nichos, videos } from "@/db/schema";
import type { InstagramItemBruto, TiktokItemBruto } from "@/jobs/apify-api";
import { rodarColetaApify } from "@/jobs/coleta-apify";
import { config, hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarTiktok: vi.fn(), buscarInstagram: vi.fn() };
});

// eslint-disable-next-line import/order -- vi.mock acima e hoisted; este import precisa vir depois para pegar o mock.
import { buscarInstagram, buscarTiktok } from "@/jobs/apify-api";

function carregarFixture<T>(nome: string): T {
  const caminho = path.resolve(process.cwd(), `tests/fixtures/coleta/${nome}`);
  return JSON.parse(readFileSync(caminho, "utf8")) as T;
}

const tiktokFixture = carregarFixture<TiktokItemBruto[]>("tiktok-itens.json");
const instagramFixture = carregarFixture<InstagramItemBruto[]>("instagram-itens.json");

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "coleta-apify-teste", nome: "Coleta Apify teste", termos: ["dentista"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(buscarTiktok).mockReset();
  vi.mocked(buscarInstagram).mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  await db().delete(consumoApi);
  await db().delete(nichos).where(eq(nichos.slug, "coleta-apify-teste-2"));
});

describe("rodarColetaApify (apify mockado, banco real)", () => {
  it("busca, normaliza e grava video, conta e audio do tiktok e do instagram", async () => {
    vi.mocked(buscarTiktok).mockResolvedValue([tiktokFixture[0]]);
    vi.mocked(buscarInstagram).mockResolvedValue([instagramFixture[0]]);

    const resumo = await rodarColetaApify();
    expect(resumo.videosNovos).toBe(2);
    expect(resumo.videosAtualizados).toBe(0);

    const [videoTiktok] = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "tiktok"), eq(videos.idExterno, tiktokFixture[0].id)));
    expect(videoTiktok).toBeDefined();
    expect(videoTiktok.audio).toEqual({
      id: "7111111111111111111",
      nome: "[exemplo] som original",
      autor: "exemplo.sorrisoemdia",
      original: true,
    });

    const [contaTiktok] = await db()
      .select()
      .from(contas)
      .where(and(eq(contas.plataforma, "tiktok"), eq(contas.handle, "exemplo.sorrisoemdia")));
    expect(contaTiktok).toBeDefined();

    const [videoInstagram] = await db()
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.plataforma, "instagram"),
          eq(videos.idExterno, instagramFixture[0].shortCode!),
        ),
      );
    expect(videoInstagram).toBeDefined();
    expect(videoInstagram.audio).toEqual({
      id: "611111111111111",
      nome: "[exemplo] som original",
      autor: "exemplo.sorrisoemdia",
      original: true,
    });
  });

  it("rodar duas vezes para o mesmo video atualiza em vez de duplicar (idempotencia)", async () => {
    vi.mocked(buscarTiktok).mockResolvedValue([tiktokFixture[1]]);
    vi.mocked(buscarInstagram).mockResolvedValue([]);
    await rodarColetaApify();

    vi.mocked(buscarTiktok).mockResolvedValue([{ ...tiktokFixture[1], playCount: 99999 }]);
    const resumo = await rodarColetaApify();
    expect(resumo.videosNovos).toBe(0);
    expect(resumo.videosAtualizados).toBe(1);

    const linhas = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "tiktok"), eq(videos.idExterno, tiktokFixture[1].id)));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].views).toBe(99999);
  });

  it("registra o consumo combinado (tiktok + instagram) em consumo_api com fonte apify", async () => {
    vi.mocked(buscarTiktok).mockResolvedValue([tiktokFixture[0], tiktokFixture[1]]);
    vi.mocked(buscarInstagram).mockResolvedValue([instagramFixture[0]]);

    await rodarColetaApify();

    const [linha] = await db()
      .select()
      .from(consumoApi)
      .where(and(eq(consumoApi.fonte, "apify"), eq(consumoApi.data, hojeISO())));
    expect(linha.unidades).toBe(3);
  });

  it("um item malformado no lote entra em erros e o resto do lote e gravado", async () => {
    const itemQuebrado = {
      ...tiktokFixture[0],
      id: "item-quebrado",
      authorMeta: undefined,
    } as unknown as TiktokItemBruto;
    vi.mocked(buscarTiktok).mockResolvedValue([itemQuebrado, tiktokFixture[1]]);
    vi.mocked(buscarInstagram).mockResolvedValue([]);

    const resumo = await rodarColetaApify();
    const erros = resumo.erros as string[] | undefined;
    expect(resumo.videosNovos).toBe(1);
    expect(erros).toHaveLength(1);
    expect(erros?.[0]).toMatch(/item-quebrado/);

    const [videoBom] = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "tiktok"), eq(videos.idExterno, tiktokFixture[1].id)));
    expect(videoBom).toBeDefined();

    const quebrados = await db()
      .select()
      .from(videos)
      .where(and(eq(videos.plataforma, "tiktok"), eq(videos.idExterno, "item-quebrado")));
    expect(quebrados).toHaveLength(0);
  });

  it("ao atingir o teto diario de resultados, para de chamar (nao processa o segundo nicho)", async () => {
    const teto = config.coleta.apifyMaxResultadosDia;
    await db()
      .insert(consumoApi)
      .values({ fonte: "apify", data: hojeISO(), unidades: teto - 1 });
    await db()
      .insert(nichos)
      .values({ slug: "coleta-apify-teste-2", nome: "Coleta Apify teste 2", termos: ["dentista"] });

    vi.mocked(buscarTiktok).mockImplementation(async (_hashtags, _perfis, maxItens) =>
      [tiktokFixture[1]].slice(0, maxItens),
    );
    vi.mocked(buscarInstagram).mockResolvedValue([]);

    const resumo = await rodarColetaApify();
    // So ha espaco para 1 resultado (teto - 1 ja consumido); um unico nicho
    // usa esse espaco inteiro, o outro nem chega a ser tentado.
    expect(resumo.chamadasTiktok).toBe(1);
    expect(resumo.chamadasInstagram).toBe(0);
    expect(resumo.tetoAtingido).toBe(true);
    expect(buscarTiktok).toHaveBeenCalledTimes(1);
    expect(buscarTiktok).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1);
  });

  it("com nichoId, roda so para aquele nicho (etapa 24, parte 1: coletar agora)", async () => {
    await db().insert(nichos).values({ slug: "coleta-apify-teste-2", nome: "Coleta Apify teste 2", termos: ["dentista"] });

    vi.mocked(buscarTiktok).mockResolvedValue([]);
    vi.mocked(buscarInstagram).mockResolvedValue([]);

    const resumo = await rodarColetaApify(nichoId);
    expect(resumo.nichos).toBe(1);
    expect(buscarTiktok).toHaveBeenCalledTimes(1);
    expect(buscarInstagram).toHaveBeenCalledTimes(1);
  });
});
