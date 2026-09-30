/**
 * `rodarExtrairSemFala` (M3, item 2): ciclo completo contra o Postgres real, com yt-dlp e ffmpeg
 * mockados (`@/jobs/video`, mesmo padrão de `analisar-visual.test.ts`), `AI_PROVIDER=mock`
 * fazendo `gerarEstruturado` cair no mock de `extrairVideoSemFala`.
 */
/* eslint-disable import/order -- vi.mock precisa vir antes do import do modulo
   mockado; mesmo ajuste de analisar-visual.test.ts. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos } from "@/db/schema";

vi.mock("@/jobs/video", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/video")>();
  return {
    ...original,
    baixarVideo480p: vi.fn(),
    apagarVideo: vi.fn(),
    extrairQuadros: vi.fn(),
    duracaoDoArquivoS: vi.fn(),
  };
});

import { rodarExtrairSemFala } from "@/jobs/extrair-sem-fala";
import { apagarVideo, baixarVideo480p, duracaoDoArquivoS, extrairQuadros } from "@/jobs/video";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

const QUADROS_FALSOS = Array.from({ length: 8 }, (_, i) => ({ segundo: i, base64: "AAAA" }));

async function criarNicho(slug: string, videoSemFalaVale: boolean | null) {
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug, nome: slug, termos: [], pisoViews: 50_000, videoSemFalaVale: videoSemFalaVale ?? undefined })
    .returning();
  return nicho;
}

async function criarVideo(
  nichoId: number,
  idExterno: string,
  opcoes: {
    views: number;
    transcricao?: string | null;
    analise?: unknown;
    duracaoS?: number;
    publicadoEm?: Date;
    idioma?: string | null;
  },
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: `[exemplo] video ${idExterno}`,
      descricao: "legenda do post de exemplo",
      views: opcoes.views,
      publicadoEm: opcoes.publicadoEm ?? diasAtras(2),
      transcricao: opcoes.transcricao === undefined ? null : opcoes.transcricao,
      analise: opcoes.analise as never,
      duracaoS: opcoes.duracaoS,
      idioma: opcoes.idioma === undefined ? null : opcoes.idioma,
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
});

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(baixarVideo480p).mockReset().mockResolvedValue("/tmp/video-fake.mp4");
  vi.mocked(apagarVideo).mockReset().mockResolvedValue(undefined);
  vi.mocked(extrairQuadros).mockReset().mockResolvedValue(QUADROS_FALSOS);
  vi.mocked(duracaoDoArquivoS).mockReset().mockResolvedValue(30);
});

describe("rodarExtrairSemFala", () => {
  it("analisa o video sem fala do setor que aceita e grava analise e etiquetas, sem tocar idioma nem tipoAbertura", async () => {
    const nicho = await criarNicho("extrair-sem-fala-aceita", true);
    const v = await criarVideo(nicho.id, "extrair-sem-fala-candidato", { views: 100_000, transcricao: null, idioma: "en" });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(1);
    expect(resumo.falhas).toBe(0);
    expect(baixarVideo480p).toHaveBeenCalledWith(v.url, "youtube");
    expect(apagarVideo).toHaveBeenCalledWith("/tmp/video-fake.mp4");

    const [linha] = await db().select().from(videos).where(eq(videos.id, v.id));
    expect(linha.analise).not.toBeNull();
    expect(linha.analise!.assunto).toBeTruthy();
    expect(linha.etiquetas.length).toBeGreaterThan(0);
    // sem fala nao tem idioma falado para julgar: o valor detectado na coleta continua o mesmo.
    expect(linha.idioma).toBe("en");
    expect(linha.tipoAbertura).toBeNull();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("setor que nao aceita video sem fala (padrao) nunca analisa, mesmo com candidato elegivel", async () => {
    const nicho = await criarNicho("extrair-sem-fala-recusa", false);
    await criarVideo(nicho.id, "extrair-sem-fala-recusado", { views: 100_000, transcricao: null });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(resumo.setoresComVideoSemFala).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("video com transcricao longa o bastante nao entra (o caminho normal de extracao ja serve)", async () => {
    const nicho = await criarNicho("extrair-sem-fala-com-transcricao", true);
    await criarVideo(nicho.id, "extrair-sem-fala-com-transcricao-video", {
      views: 100_000,
      transcricao: "uma transcricao bem mais longa do que o minimo de oitenta caracteres exigido pelo extrator comum de video",
    });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("video abaixo do piso do setor nao entra", async () => {
    const nicho = await criarNicho("extrair-sem-fala-abaixo-do-piso", true);
    await criarVideo(nicho.id, "extrair-sem-fala-abaixo-do-piso-video", { views: 1_000, transcricao: null });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("video que ja tem analise nao entra de novo", async () => {
    const nicho = await criarNicho("extrair-sem-fala-ja-analisado", true);
    await criarVideo(nicho.id, "extrair-sem-fala-ja-analisado-video", {
      views: 100_000,
      transcricao: null,
      analise: {
        assunto: "ja lido",
        gancho: "gancho",
        estrutura: "estrutura",
        fechamento: "fechamento",
        chamadaFinal: "chamada",
        formato: "outro",
        porQueFuncionou: "porque",
      },
    });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("respeita o teto diario de config.regras.analiseSemFalaPorDia", async () => {
    const nicho = await criarNicho("extrair-sem-fala-teto", true);
    const total = config.regras.analiseSemFalaPorDia + 3;
    for (let i = 0; i < total; i += 1) {
      await criarVideo(nicho.id, `extrair-sem-fala-teto-${i}`, { views: 100_000 + i, transcricao: null });
    }

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(config.regras.analiseSemFalaPorDia);

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });
});
