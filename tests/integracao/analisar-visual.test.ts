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
  duracaoDoArquivoS: vi.fn(),
}));

import { rodarAnalisarVisual } from "@/jobs/analisar-visual";
import { apagarVideo, baixarVideo480p, duracaoDoArquivoS, extrairQuadros } from "@/jobs/video";

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
    plataforma?: "youtube" | "tiktok" | "instagram";
    foraDaCurva?: number;
    publicadoEm: Date;
    transcricao?: string;
    duracaoS?: number;
    analise?: unknown;
    analiseVisual?: unknown;
    /** V2a, item 3: endereco de midia direto da Meta, e quando foi lido. */
    midiaUrl?: string;
    midiaUrlEm?: Date;
    /** Ajuste 1 da revisao do PR #45: `atualizadoEm` antigo, para provar que a analise visual nao o move (e da coleta). */
    atualizadoEm?: Date;
  },
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: opcoes.plataforma ?? "youtube",
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
      midiaUrl: opcoes.midiaUrl,
      midiaUrlEm: opcoes.midiaUrlEm,
      atualizadoEm: opcoes.atualizadoEm,
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
  vi.mocked(duracaoDoArquivoS).mockReset();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("rodarAnalisarVisual", () => {
  it("analisa o video candidato e grava analise_visual", async () => {
    const atualizadoAntes = diasAtras(5);
    const v = await criarVideo("candidato-ok", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "falou sobre o produto principal",
      duracaoS: 40,
      analise: ANALISE_PADRAO,
      atualizadoEm: atualizadoAntes,
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(1);
    expect(resumo.falhas).toBe(0);
    expect(baixarVideo480p).toHaveBeenCalledWith(v.url);
    expect(apagarVideo).toHaveBeenCalledWith("/tmp/video-fake.mp4");

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "candidato-ok"));
    expect(linha.analiseVisual).not.toBeNull();
    expect(linha.analiseVisual!.ritmoDeCorte).toBeTruthy();
    // Ajuste 1 da revisao do PR #45: o momento da leitura vai em `analiseVisualEm`; `atualizadoEm` e da coleta.
    expect(linha.analiseVisualEm).not.toBeNull();
    expect(Date.now() - linha.analiseVisualEm!.getTime()).toBeLessThan(60_000);
    expect(linha.atualizadoEm.getTime()).toBe(atualizadoAntes.getTime());
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
    expect(linhaBoa.analiseVisualEm).not.toBeNull();
    expect(linhaBoa.id).toBe(bom.id);

    const [linhaFalha] = await db().select().from(videos).where(eq(videos.idExterno, "falha-download"));
    expect(linhaFalha.analiseVisual).toBeNull();
    expect(linhaFalha.analiseVisualEm).toBeNull();
  });

  it("video sem duracao conhecida (Meta nao devolve isso, transcricao do YouTube rodada 2 item 3b): baixa, le a duracao com ffprobe e grava na coluna", async () => {
    const video = await criarVideo("sem-duracao", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      analise: ANALISE_PADRAO,
    });
    vi.mocked(duracaoDoArquivoS).mockResolvedValue(37);

    const resumo = await rodarAnalisarVisual();

    expect(resumo.analisados).toBe(1);
    expect(resumo.falhas).toBe(0);
    expect(baixarVideo480p).toHaveBeenCalledWith(video.url);
    expect(duracaoDoArquivoS).toHaveBeenCalledWith("/tmp/video-fake.mp4");

    const [linha] = await db().select().from(videos).where(eq(videos.id, video.id));
    expect(linha.duracaoS).toBe(37);
    expect(linha.analiseVisual).not.toBeNull();
  });

  it("ffprobe falhando em ler a duracao falha de forma isolada (nao da para escolher os quadros)", async () => {
    await criarVideo("sem-duracao-ffprobe-falha", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      analise: ANALISE_PADRAO,
    });
    vi.mocked(duracaoDoArquivoS).mockRejectedValue(new Error("ffprobe nao devolveu uma duracao valida"));

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(0);
    expect(resumo.falhas).toBe(1);
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

  it("video com analise antiga, sem o campo pertenceAoNicho, continua entrando como candidato", async () => {
    const analiseAntiga = {
      assunto: ANALISE_PADRAO.assunto,
      gancho: ANALISE_PADRAO.gancho,
      estrutura: ANALISE_PADRAO.estrutura,
      fechamento: ANALISE_PADRAO.fechamento,
      chamadaFinal: ANALISE_PADRAO.chamadaFinal,
      formato: ANALISE_PADRAO.formato,
      porQueFuncionou: ANALISE_PADRAO.porQueFuncionou,
    };

    const v = await criarVideo("analise-antiga", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
      analise: analiseAntiga,
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(1);
    expect(baixarVideo480p).toHaveBeenCalledWith(v.url);
  });
});

/** V2a, item 3: Instagram com endereco de midia fresco baixa direto, sem a url da pagina. */
describe("rodarAnalisarVisual, V2a item 3: instagram pela media direta", () => {
  const HORA_MS = 60 * 60 * 1000;

  it("com midiaUrl lida ha menos de 20h, baixa pelo endereco de midia, nao pela url da pagina", async () => {
    const midiaUrl = "https://scontent.cdninstagram.com/video-fresco.mp4";
    await criarVideo("visual-insta-fresco", {
      plataforma: "instagram",
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
      analise: ANALISE_PADRAO,
      midiaUrl,
      midiaUrlEm: new Date(Date.now() - 1 * HORA_MS),
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(1);
    expect(baixarVideo480p).toHaveBeenCalledWith(midiaUrl);
  });

  it("com midiaUrl lida ha mais de 20h (vencida), ignora e usa a url da pagina", async () => {
    const midiaUrl = "https://scontent.cdninstagram.com/video-vencido.mp4";
    await criarVideo("visual-insta-vencido", {
      plataforma: "instagram",
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      transcricao: "transcricao qualquer",
      duracaoS: 30,
      analise: ANALISE_PADRAO,
      midiaUrl,
      midiaUrlEm: new Date(Date.now() - 21 * HORA_MS),
    });

    const resumo = await rodarAnalisarVisual();
    expect(resumo.analisados).toBe(1);
    expect(baixarVideo480p).toHaveBeenCalledWith("https://exemplo.invalido/visual-insta-vencido");
    expect(baixarVideo480p).not.toHaveBeenCalledWith(midiaUrl);
  });
});
