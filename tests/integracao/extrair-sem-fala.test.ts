/**
 * `rodarExtrairSemFala` (M3, item 2): ciclo completo contra o Postgres real, com yt-dlp e ffmpeg
 * mockados (`@/jobs/video`, mesmo padrão de `analisar-visual.test.ts`), `AI_PROVIDER=mock`
 * fazendo `gerarEstruturado` cair no mock de `extrairVideoSemFala`.
 */
/* eslint-disable import/order -- vi.mock precisa vir antes do import do modulo
   mockado; mesmo ajuste de analisar-visual.test.ts. */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";

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

/**
 * `transcricao` por padrão "muito curta" (não `null`): item 0a da revisão dos PRs #74/#76, elegível
 * só depois da tentativa de transcrição. Um teste que precisa do caso "nunca tentou" passa
 * `transcricao: null` explícito, sem `proximaTentativaTranscricao`.
 */
async function criarVideo(
  nichoId: number,
  idExterno: string,
  opcoes: {
    views: number;
    foraDaCurva?: number;
    transcricao?: string | null;
    proximaTentativaTranscricao?: Date;
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
      foraDaCurva: opcoes.foraDaCurva === undefined ? "5" : String(opcoes.foraDaCurva),
      publicadoEm: opcoes.publicadoEm ?? diasAtras(2),
      transcricao: opcoes.transcricao === undefined ? "muito curta" : opcoes.transcricao,
      proximaTentativaTranscricao: opcoes.proximaTentativaTranscricao,
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
    const v = await criarVideo(nicho.id, "extrair-sem-fala-candidato", { views: 100_000, idioma: "en" });

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
    // M4, item 1: este e o caminho sem fala, por definicao.
    expect(linha.semFala).toBe(true);
    // Achado 5 da revisao do motor (01/10/2026): tipoConteudo/serveDeModelo tambem saem do
    // caminho sem fala agora, em coluna propria (mock: titulo sem "pov" vira "original").
    expect(linha.tipoConteudo).toBe("original");
    expect(linha.serveDeModelo).toBe(true);
    expect(linha.analise!.tipoConteudo).toBe("original");

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  /** Achado 5 da revisao do motor: meme sem fala (sinal "pov" no mock) nunca serve de modelo. */
  it("video sem fala classificado como meme (titulo com 'pov') grava serveDeModelo falso", async () => {
    const nicho = await criarNicho("extrair-sem-fala-meme", true);
    const v = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "extrair-sem-fala-meme-candidato",
        url: "https://exemplo.invalido/extrair-sem-fala-meme-candidato",
        nichoId: nicho.id,
        titulo: "[exemplo] video pov de quem esquece a senha",
        descricao: "legenda do post de exemplo",
        views: 100_000,
        foraDaCurva: "5",
        publicadoEm: diasAtras(2),
        transcricao: "muito curta",
      })
      .returning()
      .then(([linha]) => linha);

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(1);

    const [linha] = await db().select().from(videos).where(eq(videos.id, v.id));
    expect(linha.tipoConteudo).toBe("meme");
    expect(linha.serveDeModelo).toBe(false);

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("setor que nao aceita video sem fala (padrao) nunca analisa, mesmo com candidato elegivel", async () => {
    const nicho = await criarNicho("extrair-sem-fala-recusa", false);
    await criarVideo(nicho.id, "extrair-sem-fala-recusado", { views: 100_000 });

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
    await criarVideo(nicho.id, "extrair-sem-fala-abaixo-do-piso-video", { views: 1_000 });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("video que ja tem analise nao entra de novo", async () => {
    const nicho = await criarNicho("extrair-sem-fala-ja-analisado", true);
    await criarVideo(nicho.id, "extrair-sem-fala-ja-analisado-video", {
      views: 100_000,
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
      await criarVideo(nicho.id, `extrair-sem-fala-teto-${i}`, { views: 100_000 + i });
    }

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(config.regras.analiseSemFalaPorDia);

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("item 0a: video sem transcricao e sem tentativa nunca entra (so esperando a vez do transcrever)", async () => {
    const nicho = await criarNicho("extrair-sem-fala-sem-tentativa", true);
    await criarVideo(nicho.id, "extrair-sem-fala-sem-tentativa-video", { views: 100_000, transcricao: null });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("item 0a: sem transcricao mas com proximaTentativaTranscricao (tentou e falhou) entra", async () => {
    const nicho = await criarNicho("extrair-sem-fala-tentou-falhou", true);
    const v = await criarVideo(nicho.id, "extrair-sem-fala-tentou-falhou-video", {
      views: 100_000,
      transcricao: null,
      proximaTentativaTranscricao: new Date(Date.now() + 7 * DIA_MS),
    });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(1);
    expect(baixarVideo480p).toHaveBeenCalledWith(v.url, "youtube");

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("item 0b: video fora da janela de 90 dias nao entra, mesmo elegivel no resto", async () => {
    const nicho = await criarNicho("extrair-sem-fala-video-velho", true);
    await criarVideo(nicho.id, "extrair-sem-fala-video-velho-video", { views: 100_000, publicadoEm: diasAtras(120) });

    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.analisados).toBe(0);
    expect(baixarVideo480p).not.toHaveBeenCalled();

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("item 0b: com o teto menor que os candidatos, o de maior fora_da_curva entra, o na media da conta fica de fora", async () => {
    const nicho = await criarNicho("extrair-sem-fala-ordem", true);
    const bom = await criarVideo(nicho.id, "extrair-sem-fala-ordem-bom", { views: 100_000, foraDaCurva: 8 });
    const naMedia = await criarVideo(nicho.id, "extrair-sem-fala-ordem-na-media", { views: 100_000, foraDaCurva: 1.1 });

    // Os dois cabem no teto de 15 desta rodada (o corte em si já tem teste próprio, acima); a
    // prova aqui é a ordem: o de maior fora_da_curva é baixado primeiro, para quando o teto
    // apertar (setor com muito candidato) o vídeo na média da conta ser o que fica de fora.
    await rodarExtrairSemFala(nicho.id);

    const chamadas = vi.mocked(baixarVideo480p).mock.calls.map((args) => args[0]);
    const posicaoBom = chamadas.indexOf(bom.url);
    const posicaoNaMedia = chamadas.indexOf(naMedia.url);
    expect(posicaoBom).toBeGreaterThanOrEqual(0);
    expect(posicaoNaMedia).toBeGreaterThanOrEqual(0);
    expect(posicaoBom).toBeLessThan(posicaoNaMedia);

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  it("item 0e: video que falha no download ganha proxima tentativa em 7 dias e nao volta na rodada seguinte", async () => {
    const nicho = await criarNicho("extrair-sem-fala-falha-download", true);
    const v = await criarVideo(nicho.id, "extrair-sem-fala-falha-download-video", { views: 100_000 });

    vi.mocked(baixarVideo480p).mockRejectedValueOnce(new Error("download falhou de verdade"));
    const resumo = await rodarExtrairSemFala(nicho.id);
    expect(resumo.falhas).toBe(1);
    expect(resumo.analisados).toBe(0);

    const [linha] = await db().select().from(videos).where(eq(videos.id, v.id));
    expect(linha.proximaTentativaSemFala).not.toBeNull();
    expect(linha.proximaTentativaSemFala!.getTime()).toBeGreaterThan(Date.now());

    // Segunda rodada, mesmo dia: mesmo com o download voltando a funcionar, o video nao entra de
    // novo (a proxima tentativa esta no futuro).
    const resumo2 = await rodarExtrairSemFala(nicho.id);
    expect(resumo2.analisados).toBe(0);
    expect(resumo2.falhas).toBe(0);

    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
  });

  /**
   * M5b, item 1: a rodada global (sem nichoId, o cron das 04:40) encadeia direto para `extrair`
   * ao terminar, em vez de esperar o horário fixo de reserva.
   */
  describe("M5b, item 1: a rodada global encadeia extrair", () => {
    afterEach(async () => {
      await db().execute(sql`delete from pgboss.job where name = ${FILAS.extrair}`);
    });

    it("sem nichoId (a rodada global), enfileira extrair ao terminar", async () => {
      const nicho = await criarNicho("extrair-sem-fala-encadeia-global", true);
      const v = await criarVideo(nicho.id, "encadeia-global-video", { views: 100_000 });

      await rodarExtrairSemFala();

      const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrair} limit 1`);
      expect(jobs.rows.length).toBe(1);

      await db().delete(videos).where(eq(videos.id, v.id));
    });

    it("com nichoId (a cadeia síncrona da primeira carga), não enfileira extrair", async () => {
      const nicho = await criarNicho("extrair-sem-fala-encadeia-por-nicho", true);
      const v = await criarVideo(nicho.id, "encadeia-por-nicho-video", { views: 100_000 });

      await rodarExtrairSemFala(nicho.id);

      const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrair} limit 1`);
      expect(jobs.rows.length).toBe(0);

      await db().delete(videos).where(eq(videos.id, v.id));
    });
  });
});
