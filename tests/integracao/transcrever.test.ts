/**
 * `rodarTranscrever` (etapa 8): ciclo completo contra o Postgres real, com
 * yt-dlp, ffmpeg e Groq mockados (nunca baixa nem transcreve nada de
 * verdade num teste automatizado).
 */
/* eslint-disable import/order -- quatro vi.mock intercalados com os imports que
   precisam vir depois deles confundem a regra (ela conta a linha em branco entre
   os imports do bloco de cima e os de baixo como "dentro do mesmo grupo"). */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";

vi.mock("@/jobs/legendas-youtube", () => ({ baixarLegendaYoutube: vi.fn() }));
vi.mock("@/jobs/audio", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/audio")>();
  return { ...original, baixarAudio: vi.fn(), apagarAudio: vi.fn() };
});
vi.mock("@/jobs/groq-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/groq-api")>();
  return { ...original, transcreverAudio: vi.fn() };
});
vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      transcricao: { ...original.config.transcricao, groqKey: "chave-de-teste" },
      regras: { ...original.config.regras, transcricoesPorDia: 2 },
    },
  };
});

import { baixarLegendaYoutube } from "@/jobs/legendas-youtube";
import { apagarAudio, baixarAudio, ErroAudio } from "@/jobs/audio";
import { transcreverAudio } from "@/jobs/groq-api";
import { rodarTranscrever } from "@/jobs/transcrever";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;
let contaId: number;

async function criarVideo(
  idExterno: string,
  opcoes: {
    plataforma?: "youtube" | "tiktok" | "instagram";
    foraDaCurva?: number;
    velocidadeRelativa?: number;
    publicadoEm: Date;
    transcricao?: string;
    proximaTentativaTranscricao?: Date;
  },
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: opcoes.plataforma ?? "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId,
      nichoId,
      views: 100,
      publicadoEm: opcoes.publicadoEm,
      foraDaCurva: opcoes.foraDaCurva === undefined ? undefined : String(opcoes.foraDaCurva),
      velocidadeRelativa:
        opcoes.velocidadeRelativa === undefined ? undefined : String(opcoes.velocidadeRelativa),
      transcricao: opcoes.transcricao,
      proximaTentativaTranscricao: opcoes.proximaTentativaTranscricao,
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "transcrever-teste", nome: "Transcrever teste", termos: [] })
    .returning();
  nichoId = nicho.id;
  const [conta] = await db()
    .insert(contas)
    .values({ plataforma: "youtube", handle: "conta-transcrever", nichoId })
    .returning();
  contaId = conta.id;
});

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(baixarLegendaYoutube).mockReset();
  vi.mocked(baixarAudio).mockReset();
  vi.mocked(apagarAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(transcreverAudio).mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("rodarTranscrever", () => {
  it("video do YouTube com legenda disponivel grava a legenda, sem chamar audio nem Groq", async () => {
    await criarVideo("yt-com-legenda", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue("legenda transcrita do video");

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(1);
    expect(resumo.transcritosPorGroq).toBe(0);
    expect(baixarAudio).not.toHaveBeenCalled();

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-com-legenda"));
    expect(linha.transcricao).toBe("legenda transcrita do video");
  });

  it("video do YouTube sem legenda cai para audio mais Groq", async () => {
    await criarVideo("yt-sem-legenda", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito pela groq");

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorGroq).toBe(1);
    expect(apagarAudio).toHaveBeenCalledWith("/tmp/audio-fake.mp3");

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-sem-legenda"));
    expect(linha.transcricao).toBe("texto transcrito pela groq");
  });

  it("video que falha ao baixar audio marca proxima tentativa para daqui a 7 dias", async () => {
    await criarVideo("tiktok-falha", {
      plataforma: "tiktok",
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
    });
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudio("video indisponivel"));

    const resumo = await rodarTranscrever();
    expect(resumo.falhas).toBe(1);
    expect(apagarAudio).not.toHaveBeenCalled();

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "tiktok-falha"));
    expect(linha.transcricao).toBeNull();
    expect(linha.proximaTentativaTranscricao).not.toBeNull();
    const emSeteDias = Date.now() + 6 * DIA_MS;
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(emSeteDias);
  });

  it("video ja com transcricao nao e selecionado de novo", async () => {
    await criarVideo("ja-transcrito", {
      velocidadeRelativa: 3,
      publicadoEm: diasAtras(3),
      transcricao: "ja tem transcricao",
    });

    await rodarTranscrever();
    expect(baixarLegendaYoutube).not.toHaveBeenCalled();
  });

  it("video com tentativa futura marcada nao e selecionado de novo", async () => {
    await criarVideo("tentativa-futura", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      proximaTentativaTranscricao: new Date(Date.now() + DIA_MS),
    });

    await rodarTranscrever();
    expect(baixarLegendaYoutube).not.toHaveBeenCalled();
  });

  it("respeita o limite (transcricoesPorDia = 2 no mock de config)", async () => {
    await criarVideo("limite-1", { velocidadeRelativa: 5, publicadoEm: diasAtras(3) });
    await criarVideo("limite-2", { velocidadeRelativa: 4, publicadoEm: diasAtras(4) });
    await criarVideo("limite-3", { velocidadeRelativa: 3, publicadoEm: diasAtras(5) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue("legenda");

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(2);
  });
});
