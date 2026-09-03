/**
 * `rodarAnalisarVisual` (etapa 9): ciclo completo contra o Postgres real,
 * com yt-dlp e ffmpeg mockados (`@/jobs/video`, nunca baixa nem extrai
 * quadro de verdade num teste automatizado). `AI_PROVIDER=mock`
 * (`vitest.config.mts`) faz `gerarEstruturado` cair no mock de
 * `analisarVisual`, sem chamar a Anthropic de verdade.
 */
/* eslint-disable import/order -- vi.mock precisa vir antes do import do modulo
   mockado; a regra conta a linha em branco entre os imports de cima e os de
   baixo como "dentro do mesmo grupo" (mesmo ajuste de transcrever.test.ts). */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos } from "@/db/schema";

vi.mock("@/jobs/video", () => ({
  baixarVideo480p: vi.fn(),
  apagarVideo: vi.fn(),
  extrairQuadros: vi.fn(),
}));

import { rodarAnalisarVisual } from "@/jobs/analisar-visual";
import { apagarVideo, baixarVideo480p, extrairQuadros } from "@/jobs/video";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

const QUADROS_FALSOS = Array.from({ length: 8 }, (_, i) => ({ segundo: i, base64: "AAAA" }));

const ANALISE_PADRAO = {
  assunto: "assunto do video",
  gancho: "abertura do video",
  estrutura: "gancho, corpo, fechamento",
  fechamento: "resumo do que foi mostrado",
  chamadaFinal: "comenta se voce ja passou por isso",
  formato: "fala_para_camera" as const,
  porQueFuncionou: "mostra o problema acontecendo de verdade",
  pertenceAoNicho: true,
  motivoNicho: "fala do assunto do nicho",
};

let nichoId: number;

async function criarVideo(
  idExterno: string,
  opcoes: {
    foraDaCurva?: number;
    publicadoEm: Date;
    transcricao?: string;
    duracaoS?: number;
    analise?: unknown;
    analiseVisual?: unknown;
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
      views: 100,
      publicadoEm: opcoes.publicadoEm,
      foraDaCurva: opcoes.foraDaCurva === undefined ? undefined : String(opcoes.foraDaCurva),
      transcricao: opcoes.transcricao,
      duracaoS: opcoes.duracaoS,
      analise: opcoes.analise as never,
      analiseVisual: opcoes.analiseVisual as never,
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "analisar-visual-teste", nome: "Analisar visual teste", termos: [] })
    .returning();
  nichoId = nicho.id;
});

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  vi.mocked(baixarVideo480p).mockReset().mockResolvedValue("/tmp/video-fake.mp4");
  vi.mocked(apagarVideo).mockReset().mockResolvedValue(undefined);
  vi.mocked(extrairQuadros).mockReset().mockResolvedValue(QUADROS_FALSOS);
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("rodarAnalisarVisual", () => {
  it("analisa o video candidato e grava analise_visual", async () => {
    const v = await criarVideo("candidato-ok", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "falou sobre o produto principal",
      duracaoS: 40,
      analise: ANALISE_PADRAO,
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(1);
    expect(resumo.falhas).toBe(0);
    expect(baixarVideo480p).toHaveBeenCalledWith(v.url);
    expect(apagarVideo).toHaveBeenCalledWith("/tmp/video-fake.mp4");

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "candidato-ok"));
    expect(linha.analiseVisual).not.toBeNull();
    expect(linha.analiseVisual!.ritmoDeCorte).toBeTruthy();
  });

  it("video sem transcricao ou que ja tem analise visual nao entra no candidato", async () => {
    await criarVideo("sem-transcricao", { foraDaCurva: 5, publicadoEm: diasAtras(2) });
    await criarVideo("ja-tem-analise-visual", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
      analise: ANALISE_PADRAO,
      analiseVisual: {
        falaParaCamera: true,
        textoNaTela: [],
        cenario: "x",
        ritmoDeCorte: "x",
        recursos: [],
        momentoChave: null,
      },
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();
  });

  it("video publicado ha mais de 7 dias fica de fora", async () => {
    await criarVideo("antigo", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
      analise: ANALISE_PADRAO,
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(0);
  });

  it("video que falha no download nao derruba os outros, e fica registrado no resumo", async () => {
    await criarVideo("falha-download", {
      foraDaCurva: 9,
      publicadoEm: diasAtras(1),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
      analise: ANALISE_PADRAO,
    });
    const bom = await criarVideo("ok-depois-da-falha", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer, para o segundo video",
      duracaoS: 30,
      analise: ANALISE_PADRAO,
    });

    vi.mocked(baixarVideo480p).mockImplementation(async (url: string) => {
      if (url.includes("falha-download")) throw new Error("video indisponivel");
      return "/tmp/video-fake.mp4";
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(1);
    expect(resumo.falhas).toBe(1);
    expect(resumo.erros).toEqual([expect.stringContaining("video indisponivel")]);

    const [linhaBoa] = await db().select().from(videos).where(eq(videos.idExterno, "ok-depois-da-falha"));
    expect(linhaBoa.analiseVisual).not.toBeNull();
    expect(linhaBoa.id).toBe(bom.id);
  });

  it("video sem duracao conhecida falha de forma isolada (nao da para escolher os quadros)", async () => {
    await criarVideo("sem-duracao", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      analise: ANALISE_PADRAO,
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(0);
    expect(resumo.falhas).toBe(1);
    expect(baixarVideo480p).not.toHaveBeenCalled();
  });

  it("respeita o limite de visuaisPorSemana, os de maior fora_da_curva primeiro", async () => {
    for (let i = 0; i < 12; i += 1) {
      await criarVideo(`limite-${i}`, {
        foraDaCurva: i,
        publicadoEm: diasAtras(2),
        transcricao: "transcricao qualquer",
        duracaoS: 30,
        analise: ANALISE_PADRAO,
      });
    }

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(10);
  });

  it("video sem analise, ou marcado como fora do nicho, fica de fora (ajuste da revisao da etapa 9)", async () => {
    await criarVideo("sem-analise", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
    });
    await criarVideo("fora-do-nicho", {
      foraDaCurva: 9,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao de outro assunto",
      duracaoS: 30,
      analise: { ...ANALISE_PADRAO, pertenceAoNicho: false },
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();
  });
});
