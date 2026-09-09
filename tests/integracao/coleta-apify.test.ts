/**
 * Ciclo completo da coleta do Apify (TikTok e Instagram) contra o Postgres
 * real, com o cliente do Apify mockado (etapa 6, parte 2, criterio de
 * aceite): busca, normaliza e grava video, conta e audio; idempotencia
 * (rodar duas vezes atualiza em vez de duplicar); registra o consumo
 * combinado em consumo_api; para de chamar ao atingir o teto diario.
 *
 * E6 parte 3, terceira rodada: o TikTok agora e duas chamadas separadas
 * (`buscarTiktokPorHashtag`, so nos dias do rodizio; `buscarTiktokVigilancia`,
 * todo dia). Os testes que dependem de qual dia da semana "hoje" e usam
 * `vi.setSystemTime` com uma segunda-feira (grupo 0 do rodizio) ou uma
 * terca-feira (nenhum grupo, so vigilancia) fixas, para nao ficarem
 * dependentes do dia real em que a suite roda.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, execucoesJob, nichos, videos } from "@/db/schema";
import type { InstagramItemBruto, TiktokItemBruto } from "@/jobs/apify-api";
import { rodarColetaApify, termosDaRodada } from "@/jobs/coleta-apify";
import { config, hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/jobs/apify-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/apify-api")>();
  return { ...original, buscarTiktokPorHashtag: vi.fn(), buscarTiktokVigilancia: vi.fn(), buscarInstagram: vi.fn() };
});

// eslint-disable-next-line import/order -- vi.mock acima e hoisted; este import precisa vir depois para pegar o mock.
import { buscarInstagram, buscarTiktokPorHashtag, buscarTiktokVigilancia } from "@/jobs/apify-api";

/** Segunda-feira (grupo 0 do rodizio, `termosDaRodada`): busca por hashtag roda. */
const DIA_DE_RODIZIO = new Date("2026-09-07T12:00:00-03:00");
/** Terca-feira: nenhum grupo do rodizio, so a vigilancia roda. */
const DIA_SEM_RODIZIO = new Date("2026-09-08T12:00:00-03:00");

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
  vi.mocked(buscarTiktokPorHashtag).mockReset().mockResolvedValue({ itens: [], devolvidos: 0 });
  vi.mocked(buscarTiktokVigilancia).mockReset().mockResolvedValue({ itens: [], devolvidos: 0 });
  vi.mocked(buscarInstagram).mockReset().mockResolvedValue({ itens: [], devolvidos: 0 });
  vi.useFakeTimers();
  vi.setSystemTime(DIA_DE_RODIZIO);
});

afterEach(async () => {
  vi.useRealTimers();
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  await db().delete(consumoApi);
  await db().delete(nichos).where(eq(nichos.slug, "coleta-apify-teste-2"));
});

describe("termosDaRodada", () => {
  const termos = ["a", "b", "c", "d", "e", "f", "g"];

  it("segunda: grupo 0 (indices 0, 3, 6)", () => {
    expect(termosDaRodada(termos, new Date("2026-09-07T12:00:00-03:00"))).toEqual(["a", "d", "g"]);
  });

  it("quarta: grupo 1 (indices 1, 4)", () => {
    expect(termosDaRodada(termos, new Date("2026-09-09T12:00:00-03:00"))).toEqual(["b", "e"]);
  });

  it("sexta: grupo 2 (indices 2, 5)", () => {
    expect(termosDaRodada(termos, new Date("2026-09-11T12:00:00-03:00"))).toEqual(["c", "f"]);
  });

  it("terca, quinta, sabado e domingo: vazio, dia sem rodada", () => {
    for (const iso of ["2026-09-08", "2026-09-10", "2026-09-12", "2026-09-13"]) {
      expect(termosDaRodada(termos, new Date(`${iso}T12:00:00-03:00`))).toEqual([]);
    }
  });

  it("sem termo nenhum, devolve vazio mesmo num dia de rodada", () => {
    expect(termosDaRodada([], new Date("2026-09-07T12:00:00-03:00"))).toEqual([]);
  });
});

describe("rodarColetaApify (apify mockado, banco real)", () => {
  it("busca, normaliza e grava video, conta e audio do tiktok (hashtag) e do instagram", async () => {
    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [tiktokFixture[0]], devolvidos: 1 });
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [instagramFixture[0]], devolvidos: 1 });

    const resumo = await rodarColetaApify();
    expect(resumo.videosNovos).toBe(2);
    expect(resumo.videosAtualizados).toBe(0);
    expect(resumo.resultadosDevolvidos).toBe(2);

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

  it("grava execucaoId no video novo (item 5, taxa de acerto); video ja existente nunca tem o execucaoId reescrito", async () => {
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });
    const [execucao1] = await db().insert(execucoesJob).values({ nome: "coleta-apify" }).returning();
    const [execucao2] = await db().insert(execucoesJob).values({ nome: "coleta-apify" }).returning();

    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [tiktokFixture[1]], devolvidos: 1 });

    const resumo1 = await rodarColetaApify(undefined, execucao1.id);
    expect(resumo1.videosNovos).toBe(1);
    const [linha1] = await db().select().from(videos).where(eq(videos.idExterno, tiktokFixture[1].id));
    expect(linha1.execucaoId).toBe(execucao1.id);

    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({
      itens: [{ ...tiktokFixture[1], playCount: 42 }],
      devolvidos: 1,
    });
    const resumo2 = await rodarColetaApify(undefined, execucao2.id);
    expect(resumo2.videosAtualizados).toBe(1);
    const [linha2] = await db().select().from(videos).where(eq(videos.idExterno, tiktokFixture[1].id));
    expect(linha2.execucaoId).toBe(execucao1.id);
    expect(linha2.views).toBe(42);
  });

  it("sem execucaoId (chamada direta, sem passar por executarComRegistro), grava execucaoId nulo", async () => {
    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [tiktokFixture[0]], devolvidos: 1 });
    await rodarColetaApify();
    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, tiktokFixture[0].id));
    expect(linha.execucaoId).toBeNull();
  });

  it("num dia sem rodizio, a busca por hashtag nao roda, so a vigilancia (itens 1 e 2)", async () => {
    vi.setSystemTime(DIA_SEM_RODIZIO);
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-vigiada", nichoId, vigiada: true });

    vi.mocked(buscarTiktokVigilancia).mockResolvedValue({ itens: [tiktokFixture[0]], devolvidos: 1 });

    const resumo = await rodarColetaApify(nichoId);

    expect(buscarTiktokPorHashtag).not.toHaveBeenCalled();
    expect(buscarTiktokVigilancia).toHaveBeenCalledWith(["conta-vigiada"], 5, 5);
    expect(resumo.chamadasTiktok).toBe(1);
  });

  it("num dia de rodizio, busca por hashtag e vigilancia rodam as duas (itens 1, 2 e 3)", async () => {
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-vigiada", nichoId, vigiada: true });

    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [], devolvidos: 0 });
    vi.mocked(buscarTiktokVigilancia).mockResolvedValue({ itens: [], devolvidos: 0 });

    const resumo = await rodarColetaApify(nichoId);

    // "dentista" e o unico termo do nicho: grupo 0 (segunda) inclui o indice 0.
    expect(buscarTiktokPorHashtag).toHaveBeenCalledWith(["dentista"], 30);
    expect(buscarTiktokVigilancia).toHaveBeenCalledWith(["conta-vigiada"], 5, 5);
    expect(resumo.chamadasTiktok).toBe(2);
  });

  it("rodar duas vezes para o mesmo video atualiza em vez de duplicar (idempotencia)", async () => {
    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [tiktokFixture[1]], devolvidos: 1 });
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });
    await rodarColetaApify();

    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({
      itens: [{ ...tiktokFixture[1], playCount: 99999 }],
      devolvidos: 1,
    });
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
    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [tiktokFixture[0], tiktokFixture[1]], devolvidos: 2 });
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [instagramFixture[0]], devolvidos: 1 });

    const resumo = await rodarColetaApify();
    expect(resumo.resultadosConsumidos).toBe(3);

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
    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [itemQuebrado, tiktokFixture[1]], devolvidos: 2 });
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

    const resumo = await rodarColetaApify();
    const erros = resumo.erros as string[] | undefined;
    expect(resumo.videosNovos).toBe(1);
    expect(erros).toHaveLength(1);
    expect(erros?.[0]).toMatch(/item-quebrado/);
    // Pula com um aviso claro, nao com a mensagem crua do "Cannot read
    // properties of undefined" (rodada de acabamento de 06/09, item 3).
    expect(erros?.[0]).toMatch(/sem nome do autor, pulado/);

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

    vi.mocked(buscarTiktokPorHashtag).mockImplementation(async (_termos, maxItens) => {
      const itens = [tiktokFixture[1]].slice(0, maxItens);
      return { itens, devolvidos: itens.length };
    });
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

    const resumo = await rodarColetaApify();
    // So ha espaco para 1 resultado (teto - 1 ja consumido); um unico nicho
    // usa esse espaco inteiro na busca por hashtag (dia de rodizio), o outro
    // nem chega a ser tentado.
    expect(resumo.chamadasTiktok).toBe(1);
    expect(resumo.chamadasInstagram).toBe(0);
    expect(resumo.tetoAtingido).toBe(true);
    expect(buscarTiktokPorHashtag).toHaveBeenCalledTimes(1);
    expect(buscarTiktokPorHashtag).toHaveBeenCalledWith(["dentista"], 1);
  });

  it("com nichoId, roda so para aquele nicho (etapa 24, parte 1: coletar agora)", async () => {
    await db().insert(nichos).values({ slug: "coleta-apify-teste-2", nome: "Coleta Apify teste 2", termos: ["dentista"] });

    vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [], devolvidos: 0 });
    vi.mocked(buscarInstagram).mockResolvedValue({ itens: [], devolvidos: 0 });

    const resumo = await rodarColetaApify(nichoId);
    expect(resumo.nichos).toBe(1);
    expect(buscarTiktokPorHashtag).toHaveBeenCalledTimes(1);
    expect(buscarInstagram).toHaveBeenCalledTimes(1);
  });

  it("com meta ativo, pula o instagram (a vigilancia e a base dele vem da business discovery, meta-contas.ts), mas o tiktok continua", async () => {
    config.coleta.metaAtivo = true;
    try {
      vi.mocked(buscarTiktokPorHashtag).mockResolvedValue({ itens: [tiktokFixture[0]], devolvidos: 1 });

      const resumo = await rodarColetaApify();

      expect(resumo.chamadasTiktok).toBe(1);
      expect(resumo.chamadasInstagram).toBe(0);
      expect(buscarInstagram).not.toHaveBeenCalled();
      expect(buscarTiktokPorHashtag).toHaveBeenCalledTimes(1);
    } finally {
      config.coleta.metaAtivo = false;
    }
  });
});
