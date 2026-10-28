/**
 * Job `curva-cliente`, TikTok por URL (27/10/2026): o `yt-dlp` simulado (o processo de verdade nunca roda aqui) lê primeiro, a Apify de mentira só entra de
 * reserva, quando o `yt-dlp` falha e ela tem saldo. Banco real, como `curva-cliente.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      coleta: { ...original.config.coleta, apifyToken: "token-de-teste", apifyMaxResultadosDia: 1000, tiktokYtdlp: true },
    },
  };
});

const actorCall = vi.fn();
const datasetListItems = vi.fn();

vi.mock("apify-client", () => ({
  ApifyClient: vi.fn().mockImplementation(function ApifyClientFalso(this: {
    actor: () => { call: typeof actorCall };
    dataset: () => { listItems: typeof datasetListItems };
  }) {
    this.actor = () => ({ call: actorCall });
    this.dataset = () => ({ listItems: datasetListItems });
  }),
}));

import { db, getPool } from "@/db";
import { clientes, consumoApi, metricasVideoCliente, user, videosCliente } from "@/db/schema";
import { rodarCurvaCliente } from "@/jobs/curva-cliente";
import type { ExecutorDeProcesso } from "@/jobs/processo";
import { config, hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "tiktok-ytdlp-video.json"), "utf8")) as {
  comMetricasAltas: Record<string, unknown>;
  comMetricasZeradas: Record<string, unknown>;
};

const AGORA = new Date("2026-10-27T12:00:00Z");
let clienteId: number;

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values({ id: "curva-tiktok-teste", name: "[teste] cliente tiktok", email: "curva-tiktok@curva.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "curva-tiktok-teste", nome: "[teste] cliente tiktok" }).returning();
  clienteId = cliente.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  actorCall.mockReset().mockResolvedValue({ defaultDatasetId: "ds1" });
  datasetListItems.mockReset().mockResolvedValue({ items: [] });
});

afterEach(async () => {
  config.coleta.tiktokYtdlp = true;
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(consumoApi);
});

async function postarTiktok(...ids: string[]) {
  const postadoEm = new Date(AGORA.getTime() - 2 * 60 * 60 * 1000);
  return db()
    .insert(videosCliente)
    .values(ids.map((id) => ({ clienteId, plataforma: "tiktok" as const, url: `https://www.tiktok.com/@x/video/${id}`, idExterno: id, postadoEm })))
    .returning();
}

/** O `yt-dlp` simulado: responde pela URL pedida; devolve o JSON do estudo, ou lança como o processo de verdade lançaria. */
function ytdlpQue(respostas: Record<string, "ok" | "zerado" | { falha: string } | "tempo">): ExecutorDeProcesso & { chamadas: string[] } {
  const chamadas: string[] = [];
  const executar = (async (_comando: string, argumentos: string[]) => {
    const url = argumentos[argumentos.length - 1];
    chamadas.push(url);
    const id = /video\/(\d+)/.exec(url)![1];
    const resposta = respostas[id];
    if (resposta === "ok") return { stdout: JSON.stringify({ ...FIXTURE.comMetricasAltas, id }), stderr: "" };
    if (resposta === "zerado") return { stdout: JSON.stringify({ ...FIXTURE.comMetricasZeradas, id }), stderr: "" };
    if (resposta === "tempo") throw Object.assign(new Error("Command failed: yt-dlp --proxy http://u:SENHA@p"), { killed: true });
    throw Object.assign(new Error("Command failed: yt-dlp --proxy http://u:SENHA@p"), { stderr: resposta.falha });
  }) as ExecutorDeProcesso;
  return Object.assign(executar, { chamadas });
}

function itemApify(id: string, views: number) {
  return {
    id,
    webVideoUrl: `https://www.tiktok.com/@x/video/${id}`,
    authorMeta: { name: "conta_exemplo" },
    playCount: views,
    diggCount: 7,
    commentCount: 3,
  };
}

describe("rodarCurvaCliente, TikTok por URL (yt-dlp primeiro, Apify de reserva)", () => {
  it("o yt-dlp lê tudo: grava a fonte ytdlp, não chama a Apify, não gasta o teto dela e espera entre as leituras", async () => {
    const [v1, v2] = await postarTiktok("7600000000000000001", "7600000000000000002");
    const executarYtdlp = ytdlpQue({ "7600000000000000001": "ok", "7600000000000000002": "zerado" });
    const pausas: number[] = [];

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async (ms) => void pausas.push(ms) });

    expect(resumo.medidosTiktok).toBe(2);
    expect(resumo.porYtdlp).toBe(2);
    expect(resumo.porApify).toBe(0);
    expect(resumo.erros).toBeUndefined();
    expect(actorCall).not.toHaveBeenCalled();
    expect(pausas).toHaveLength(1);
    expect(pausas[0]).toBeGreaterThanOrEqual(3000);
    expect(pausas[0]).toBeLessThanOrEqual(6000);

    const metricas = await db().select().from(metricasVideoCliente);
    const porVideo = new Map(metricas.map((m) => [m.videoClienteId, m]));
    expect(porVideo.get(v1.id)).toMatchObject({ views: 44800, likes: 3797, comentarios: 25, fonte: "ytdlp" });
    expect(porVideo.get(v2.id)).toMatchObject({ views: 1588, likes: 21, comentarios: 0, fonte: "ytdlp" });
    expect(await db().select().from(consumoApi)).toHaveLength(0);
    const [linha] = await db().select().from(videosCliente).where(eq(videosCliente.id, v1.id));
    expect(linha.ultimaColeta).not.toBeNull();
  });

  it("o yt-dlp falha neste vídeo (outra falha) e a Apify tem saldo: lê pela Apify, o resumo conta os dois, e o outro vídeo segue no yt-dlp", async () => {
    const [v1, v2] = await postarTiktok("7600000000000000001", "7600000000000000002");
    datasetListItems.mockResolvedValue({ items: [itemApify("7600000000000000001", 999)] });
    const executarYtdlp = ytdlpQue({ "7600000000000000001": { falha: "ERROR: algo que ninguem previu" }, "7600000000000000002": "ok" });

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async () => undefined });

    expect(resumo.porYtdlp).toBe(1);
    expect(resumo.porApify).toBe(1);
    expect(actorCall).toHaveBeenCalledTimes(1);
    const metricas = await db().select().from(metricasVideoCliente);
    const porVideo = new Map(metricas.map((m) => [m.videoClienteId, m]));
    expect(porVideo.get(v1.id)).toMatchObject({ views: 999, fonte: "apify" });
    expect(porVideo.get(v2.id)).toMatchObject({ views: 44800, fonte: "ytdlp" });
    const [consumo] = await db().select().from(consumoApi);
    expect(consumo).toMatchObject({ fonte: "apify", unidades: 1 });
  });

  it("o firewall do TikTok barra o yt-dlp: para de usá-lo pelo resto da rodada (uma tentativa só) e o resto vai para a Apify", async () => {
    await postarTiktok("7600000000000000001", "7600000000000000002", "7600000000000000003");
    datasetListItems.mockResolvedValue({ items: [itemApify("x", 50)] });
    const executarYtdlp = ytdlpQue({
      "7600000000000000001": { falha: "ERROR: [TikTok] 1: Unable to extract webpage video data; Failed to parse JSON Expecting value" },
    });

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async () => undefined });

    expect(executarYtdlp.chamadas).toHaveLength(1);
    expect(resumo.porYtdlp).toBe(0);
    expect(resumo.porApify).toBe(3);
    expect(actorCall).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(resumo.erros)).toContain("yt-dlp parado ate a proxima hora");
  });

  it("três falhas seguidas do yt-dlp (tempo limite) também o param, sem derrubar a rodada", async () => {
    await postarTiktok("7600000000000000001", "7600000000000000002", "7600000000000000003", "7600000000000000004");
    datasetListItems.mockResolvedValue({ items: [itemApify("x", 50)] });
    const executarYtdlp = ytdlpQue({
      "7600000000000000001": "tempo",
      "7600000000000000002": "tempo",
      "7600000000000000003": "tempo",
      "7600000000000000004": "ok",
    });

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async () => undefined });

    expect(executarYtdlp.chamadas).toHaveLength(3);
    expect(resumo.porYtdlp).toBe(0);
    expect(resumo.porApify).toBe(4);
  });

  it("vídeo apagado ou privado: o yt-dlp diz que não existe, e a Apify (que cobraria um resultado) não é chamada", async () => {
    await postarTiktok("7600000000000000001");
    const executarYtdlp = ytdlpQue({ "7600000000000000001": { falha: "ERROR: [TikTok] 7600000000000000001: Video not available" } });

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async () => undefined });

    expect(resumo.medidosTiktok).toBe(0);
    expect(actorCall).not.toHaveBeenCalled();
    expect(JSON.stringify(resumo.erros)).toContain("nao encontrado");
    expect(await db().select().from(metricasVideoCliente)).toHaveLength(0);
  });

  it("o yt-dlp falha e a Apify está sem saldo (teto do dia batido): não mede, avisa, e tenta na próxima hora", async () => {
    await postarTiktok("7600000000000000001");
    await db().insert(consumoApi).values({ fonte: "apify", data: hojeISO(), unidades: config.coleta.apifyMaxResultadosDia });
    const executarYtdlp = ytdlpQue({ "7600000000000000001": { falha: "ERROR: algo que ninguem previu" } });

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async () => undefined });

    expect(resumo.medidosTiktok).toBe(0);
    expect(actorCall).not.toHaveBeenCalled();
    expect(JSON.stringify(resumo.erros)).toContain("teto diario do apify atingido");
    expect(JSON.stringify(resumo.erros)).not.toContain("SENHA");
  });

  it("TIKTOK_YTDLP desligado: volta para a Apify sozinha, sem tocar no yt-dlp", async () => {
    config.coleta.tiktokYtdlp = false;
    const [v1] = await postarTiktok("7600000000000000001");
    datasetListItems.mockResolvedValue({ items: [itemApify("7600000000000000001", 321)] });
    const executarYtdlp = ytdlpQue({});

    const resumo = await rodarCurvaCliente(AGORA, { executarYtdlp, esperar: async () => undefined });

    expect(executarYtdlp.chamadas).toHaveLength(0);
    expect(resumo.porApify).toBe(1);
    const [metrica] = await db().select().from(metricasVideoCliente).where(eq(metricasVideoCliente.videoClienteId, v1.id));
    expect(metrica).toMatchObject({ views: 321, fonte: "apify" });
  });
});
