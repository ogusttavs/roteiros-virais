/**
 * `rodarTranscrever` (etapa 8): ciclo completo contra o Postgres real, com
 * yt-dlp, ffmpeg e Groq mockados (nunca baixa nem transcreve nada de
 * verdade num teste automatizado).
 */
/* eslint-disable import/order -- quatro vi.mock intercalados com os imports que
   precisam vir depois deles confundem a regra (ela conta a linha em branco entre
   os imports do bloco de cima e os de baixo como "dentro do mesmo grupo"). */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";

vi.mock("@/jobs/legendas-youtube", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/legendas-youtube")>();
  return { ...original, baixarLegendaYoutube: vi.fn() };
});
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

import { baixarLegendaYoutube, ErroLegendaTempoLimite } from "@/jobs/legendas-youtube";
import { apagarAudio, baixarAudio, ErroAudio, ErroAudioTempoLimite } from "@/jobs/audio";
import { ErroGroqTempoLimite, transcreverAudio } from "@/jobs/groq-api";
import { rodarTranscrever } from "@/jobs/transcrever";
import { config } from "@/lib/config";

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
    duracaoS?: number;
    /** V2a, item 2: sem dono nunca conta no teto de 2 por conta; usado nos testes do item 1 para nao interferir. */
    semDono?: boolean;
    /** V2a, item 3: endereco de midia direto da Meta, e quando foi lido. */
    midiaUrl?: string;
    midiaUrlEm?: Date;
    /** Ajuste 1 da revisao do PR #45: `atualizadoEm` antigo, para provar que a transcricao nao o move (e da coleta). */
    atualizadoEm?: Date;
    /** V2b, item 6: "pt" por padrao, para os testes que nao sao sobre a proporcao nao serem afetados por ela. */
    idioma?: string | null;
  },
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: opcoes.plataforma ?? "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId: opcoes.semDono ? null : contaId,
      nichoId,
      views: 100,
      publicadoEm: opcoes.publicadoEm,
      foraDaCurva: opcoes.foraDaCurva === undefined ? undefined : String(opcoes.foraDaCurva),
      velocidadeRelativa:
        opcoes.velocidadeRelativa === undefined ? undefined : String(opcoes.velocidadeRelativa),
      transcricao: opcoes.transcricao,
      proximaTentativaTranscricao: opcoes.proximaTentativaTranscricao,
      duracaoS: opcoes.duracaoS,
      midiaUrl: opcoes.midiaUrl,
      midiaUrlEm: opcoes.midiaUrlEm,
      atualizadoEm: opcoes.atualizadoEm,
      idioma: opcoes.idioma === undefined ? "pt" : opcoes.idioma,
    })
    .returning();
  return v;
}

const LEGENDA_LONGA =
  "legenda transcrita do video com bastante detalhe para passar do tamanho minimo exigido " +
  "pelo job, contando a historia inteira do que foi dito do inicio ao fim sem cortar nada, " +
  "com mais uma frase soh para garantir que passa dos duzentos caracteres pedidos no teste.";

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
  config.regras.transcricoesPorDia = 2;
});

describe("rodarTranscrever", () => {
  it("video do YouTube com legenda disponivel grava a legenda, sem chamar audio nem Groq", async () => {
    const atualizadoAntes = diasAtras(5);
    await criarVideo("yt-com-legenda", {
      velocidadeRelativa: 3,
      publicadoEm: diasAtras(3),
      atualizadoEm: atualizadoAntes,
    });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(1);
    expect(resumo.transcritosPorGroq).toBe(0);
    expect(baixarAudio).not.toHaveBeenCalled();

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-com-legenda"));
    expect(linha.transcricao).toBe(LEGENDA_LONGA);
    // Ajuste 1 da revisao do PR #45: o momento da leitura vai em `transcritoEm`; `atualizadoEm` e da coleta.
    expect(linha.transcritoEm).not.toBeNull();
    expect(Date.now() - linha.transcritoEm!.getTime()).toBeLessThan(60_000);
    expect(linha.atualizadoEm.getTime()).toBe(atualizadoAntes.getTime());
  });

  it("video longo (acima do teto de duracao) nunca entra na fila de transcricao (hotfix de 30/09/2026)", async () => {
    await criarVideo("yt-longo-demais", { velocidadeRelativa: 50, publicadoEm: diasAtras(3), duracaoS: 600 });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito pela groq", idiomaDetectado: "pt", semFala: false });

    await rodarTranscrever();

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-longo-demais"));
    expect(linha.transcricao).toBeNull();
    expect(linha.transcritoEm).toBeNull();
  });

  it("video do YouTube sem legenda cai para audio mais Groq, e o resumo acumula o custo", async () => {
    const atualizadoAntes = diasAtras(5);
    await criarVideo("yt-sem-legenda", {
      velocidadeRelativa: 3,
      publicadoEm: diasAtras(3),
      // 120 s, dentro do teto de duração (hotfix de 30/09/2026); eram 600 s, que hoje nem entram na fila.
      duracaoS: 120,
      atualizadoEm: atualizadoAntes,
    });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito pela groq", idiomaDetectado: "pt", semFala: false });

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorGroq).toBe(1);
    expect(apagarAudio).toHaveBeenCalledWith("/tmp/audio-fake.mp3");
    expect(resumo.segundosAudioGroq).toBe(120);
    expect(resumo.custoEstimadoGroqUsd).toBeCloseTo((120 / 3600) * 0.04, 4);

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-sem-legenda"));
    expect(linha.transcricao).toBe("texto transcrito pela groq");
    expect(linha.transcritoEm).not.toBeNull();
    expect(Date.now() - linha.transcritoEm!.getTime()).toBeLessThan(60_000);
    expect(linha.atualizadoEm.getTime()).toBe(atualizadoAntes.getTime());
  });

  it("legenda curta demais e tratada como sem legenda e cai para audio mais Groq", async () => {
    await criarVideo("yt-legenda-curta", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue("E ai, tudo bem com voce hoje?");
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito pela groq", idiomaDetectado: "pt", semFala: false });

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(0);
    expect(resumo.transcritosPorGroq).toBe(1);
    // Ajuste 2 da revisao do PR #45: a plataforma da linha e o segundo argumento (decide seletor e proxy).
    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/yt-legenda-curta", "youtube");

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-legenda-curta"));
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
    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/tiktok-falha", "tiktok");

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "tiktok-falha"));
    expect(linha.transcricao).toBeNull();
    expect(linha.transcritoEm).toBeNull();
    expect(linha.proximaTentativaTranscricao).not.toBeNull();
    const emSeteDias = Date.now() + 6 * DIA_MS;
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(emSeteDias);
  });

  it("video do youtube que falha com a mensagem do bot marca proxima tentativa para daqui a 3 dias, e falhasYoutubeBot conta a parte (achado da conferencia de producao, 09/09/2026)", async () => {
    await criarVideo("yt-bloqueado-bot", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockRejectedValue(
      new ErroAudio(
        "nao foi possivel baixar o audio: ERROR: [youtube] abc123: Sign in to confirm you're not a bot. " +
          "Use --cookies-from-browser or --cookies for the authentication.",
      ),
    );

    const resumo = await rodarTranscrever();
    expect(resumo.falhas).toBe(1);
    expect(resumo.falhasYoutubeBot).toBe(1);

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-bloqueado-bot"));
    expect(linha.transcricao).toBeNull();
    expect(linha.proximaTentativaTranscricao).not.toBeNull();
    const emTresDias = Date.now() + 2 * DIA_MS;
    const emQuatroDias = Date.now() + 4 * DIA_MS;
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(emTresDias);
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeLessThan(emQuatroDias);
  });

  it("video que falha ao baixar audio com uma mensagem generica (nao a do bot) continua com 7 dias, mesmo sendo do youtube", async () => {
    await criarVideo("yt-falha-generica", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudio("video privado ou removido"));

    const resumo = await rodarTranscrever();
    expect(resumo.falhas).toBe(1);
    expect(resumo.falhasYoutubeBot).toBe(0);

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-falha-generica"));
    const emSeteDias = Date.now() + 6 * DIA_MS;
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(emSeteDias);
  });

  /**
   * Achado 13 da revisão do motor (01/10/2026): transcrição vazia sem a Groq confirmar ausência de
   * fala (no_speech_prob baixo) vira falha de verdade, com nova tentativa em 7 dias; sem isto,
   * `transcricao` virava uma string vazia permanente, e o achado 1 (`isNull(videos.transcricao)`)
   * nunca mais oferecia o vídeo de novo, mesmo com a data de nova tentativa já vencida.
   */
  it("transcricao vazia sem semFala conta como falha, com nova tentativa em 7 dias, nunca grava transcricao vazia", async () => {
    await criarVideo("yt-transcricao-vazia", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "", idiomaDetectado: "pt", semFala: false });

    const resumo = await rodarTranscrever();
    expect(resumo.falhas).toBe(1);
    expect(resumo.transcritosPorGroq).toBe(0);

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-transcricao-vazia"));
    expect(linha.transcricao).toBeNull();
    expect(linha.transcritoEm).toBeNull();
    expect(linha.proximaTentativaTranscricao).not.toBeNull();
    const emSeteDias = Date.now() + 6 * DIA_MS;
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(emSeteDias);
  });

  /** Achado 3: transcricao vazia COM semFala (a Groq confirmou ausencia de fala) e sucesso, nao falha. */
  it("transcricao vazia com semFala conta como sucesso, grava transcricao vazia, sem nova tentativa", async () => {
    await criarVideo("yt-sem-fala-confirmado", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "", idiomaDetectado: "pt", semFala: true });

    const resumo = await rodarTranscrever();
    expect(resumo.falhas).toBe(0);
    expect(resumo.transcritosPorGroq).toBe(1);

    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "yt-sem-fala-confirmado"));
    expect(linha.transcricao).toBe("");
    expect(linha.transcritoEm).not.toBeNull();
    expect(linha.proximaTentativaTranscricao).toBeNull();
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
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(2);
  });
});

/**
 * V2a, item 1 (força-tarefa da viagem): "vaga perdida não conta". Os
 * vídeos destes testes usam `semDono: true` (contaId nulo) para o teto de
 * 2 por conta do item 2 não interferir na contagem.
 */
describe("rodarTranscrever, V2a item 1: vaga perdida nao conta", () => {
  it("40 sucessos com 15 falhas no meio: a fila maior (4x o teto) cobre as vagas perdidas pelas falhas", async () => {
    config.regras.transcricoesPorDia = 40;

    const INDICES_DE_FALHA = new Set([2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44]);
    const TOTAL = 55;
    for (let i = 0; i < TOTAL; i += 1) {
      const idExterno = INDICES_DE_FALHA.has(i) ? `falha-${i}` : `ok-${i}`;
      await criarVideo(idExterno, { velocidadeRelativa: TOTAL - i, publicadoEm: diasAtras(3), semDono: true });
    }

    vi.mocked(baixarLegendaYoutube).mockImplementation(async (url: string) =>
      url.includes("/falha-") ? null : LEGENDA_LONGA,
    );
    vi.mocked(baixarAudio).mockImplementation(async (url: string) => {
      if (url.includes("/falha-")) throw new ErroAudio("falha simulada no download");
      return "/tmp/audio-fake.mp3";
    });
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito pela groq", idiomaDetectado: "pt", semFala: false });

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(40);
    expect(resumo.falhas).toBe(15);
    expect((resumo.sucessos as Record<string, number>).youtube).toBe(40);
    expect((resumo.tentativas as Record<string, number>).youtube).toBe(TOTAL);
    expect(resumo.youtubePausado).toBe(false);
  });

  it("freio do YouTube: para de tentar depois de 10 falhas seguidas com a mensagem do bot, registra youtubePausado", async () => {
    config.regras.transcricoesPorDia = 40;

    const MENSAGEM_BOT =
      "nao foi possivel baixar o audio: ERROR: [youtube] abc: Sign in to confirm you're not a bot. " +
      "Use --cookies-from-browser or --cookies for the authentication.";
    const TOTAL = 12;
    for (let i = 0; i < TOTAL; i += 1) {
      await criarVideo(`bot-${i}`, { velocidadeRelativa: TOTAL - i, publicadoEm: diasAtras(3), semDono: true });
    }

    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudio(MENSAGEM_BOT));

    const resumo = await rodarTranscrever();
    expect(resumo.youtubePausado).toBe(true);
    expect(resumo.falhasYoutubeBot).toBe(10);
    expect(resumo.falhas).toBe(10);
    // As duas ultimas (as de menor prioridade) nunca foram tentadas: o freio parou o laco antes.
    expect(baixarLegendaYoutube).toHaveBeenCalledTimes(10);
  });

  it("a fila acabando antes do teto: menos candidatos elegiveis que o teto, sem erro, so o que tinha", async () => {
    config.regras.transcricoesPorDia = 40;

    await criarVideo("poucos-1", { velocidadeRelativa: 3, publicadoEm: diasAtras(3), semDono: true });
    await criarVideo("poucos-2", { velocidadeRelativa: 2, publicadoEm: diasAtras(3), semDono: true });
    await criarVideo("poucos-3", { velocidadeRelativa: 1, publicadoEm: diasAtras(3), semDono: true });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorLegenda).toBe(3);
    expect(resumo.falhas).toBe(0);
  });
});

/** V2a, item 3: Instagram com endereco de midia fresco baixa direto, sem a url da pagina. */
/**
 * V2b, item 6 (revisão do PR #46): a proporção 70/30 corta o excesso de
 * internacional da fila com base em quantos brasileiros de fato entraram,
 * não no tamanho da fila.
 */
describe("rodarTranscrever, achado 2 da revisao do motor: sem proporcao do Brasil na fila de leitura", () => {
  it("sem a proporcao, os cinco de maior prioridade entram, mesmo todos internacionais", async () => {
    // FATOR_FILA (fixo, transcrever.ts) = 4; teto diario 5 => tamanhoFila = 20. Dez "en" com
    // prioridade maior (foraDaCurva mais alto) que os cinco "pt": antes da M5a, a proporcao 70/30
    // cortava o "en" em 2; agora a ordem de prioridade manda sozinha, e os cinco primeiros "en"
    // fecham o teto diario antes de qualquer "pt" ou "en" de prioridade menor ser tentado.
    config.regras.transcricoesPorDia = 5;

    const urlsEn: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      const [conta] = await db()
        .insert(contas)
        .values({ plataforma: "youtube", handle: `proporcao-en-${i}`, nichoId })
        .returning();
      const [video] = await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `proporcao-en-${i}`,
          url: `https://exemplo.invalido/proporcao-en-${i}`,
          contaId: conta.id,
          nichoId,
          views: 100,
          publicadoEm: diasAtras(10),
          foraDaCurva: String(30 - i), // en-1 (29) maior prioridade, en-10 (20) menor
          idioma: "en",
        })
        .returning();
      urlsEn.push(video.url);
    }

    const urlsPt: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const [conta] = await db()
        .insert(contas)
        .values({ plataforma: "youtube", handle: `proporcao-pt-${i}`, nichoId })
        .returning();
      const [video] = await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `proporcao-pt-${i}`,
          url: `https://exemplo.invalido/proporcao-pt-${i}`,
          contaId: conta.id,
          nichoId,
          views: 100,
          publicadoEm: diasAtras(10),
          foraDaCurva: String(5 - i), // bem menor prioridade que qualquer "en"
          idioma: "pt",
        })
        .returning();
      urlsPt.push(video.url);
    }

    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

    await rodarTranscrever();

    const chamadas = vi.mocked(baixarLegendaYoutube).mock.calls.map(([url]) => url);
    // Os cinco "en" de maior prioridade fecham o teto diario, nenhum "pt" e tentado.
    expect(chamadas).toEqual(expect.arrayContaining(urlsEn.slice(0, 5)));
    for (const url of [...urlsEn.slice(5), ...urlsPt]) {
      expect(chamadas).not.toContain(url);
    }
  });

  /** Achado 2: sem nenhum brasileiro disponivel, o internacional entra normalmente na fila agora. */
  it("sem nenhum brasileiro disponivel, o internacional entra normalmente na fila", async () => {
    config.regras.transcricoesPorDia = 5;

    for (let i = 1; i <= 5; i += 1) {
      const [conta] = await db()
        .insert(contas)
        .values({ plataforma: "youtube", handle: `sem-brasil-en-${i}`, nichoId })
        .returning();
      await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `sem-brasil-en-${i}`,
          url: `https://exemplo.invalido/sem-brasil-en-${i}`,
          contaId: conta.id,
          nichoId,
          views: 100,
          publicadoEm: diasAtras(10),
          foraDaCurva: String(10 - i),
          idioma: "en",
        });
    }

    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

    const resumo = await rodarTranscrever();

    expect(baixarLegendaYoutube).toHaveBeenCalledTimes(5);
    expect((resumo.tentativas as Record<string, number>).youtube).toBe(5);
  });
});

describe("rodarTranscrever, V2a item 3: instagram pela media direta", () => {
  const HORA_MS = 60 * 60 * 1000;

  it("com midiaUrl lida ha menos de 20h, baixa pelo endereco de midia, nao pela url da pagina", async () => {
    const midiaUrl = "https://scontent.cdninstagram.com/video-fresco.mp4";
    await criarVideo("insta-fresco", {
      plataforma: "instagram",
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      midiaUrl,
      midiaUrlEm: new Date(Date.now() - 1 * HORA_MS),
    });
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito", idiomaDetectado: "pt", semFala: false });

    await rodarTranscrever();
    expect(baixarAudio).toHaveBeenCalledWith(midiaUrl, "instagram");
  });

  it("com midiaUrl lida ha mais de 20h (vencida), ignora e usa a url da pagina", async () => {
    const midiaUrl = "https://scontent.cdninstagram.com/video-vencido.mp4";
    await criarVideo("insta-vencido", {
      plataforma: "instagram",
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      midiaUrl,
      midiaUrlEm: new Date(Date.now() - 21 * HORA_MS),
    });
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito", idiomaDetectado: "pt", semFala: false });

    await rodarTranscrever();
    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/insta-vencido", "instagram");
    expect(baixarAudio).not.toHaveBeenCalledWith(midiaUrl, expect.anything());
  });

  it("sem midiaUrl nenhuma, usa a url da pagina normalmente", async () => {
    await criarVideo("insta-sem-midia", { plataforma: "instagram", foraDaCurva: 5, publicadoEm: diasAtras(10) });
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue({ texto: "texto transcrito", idiomaDetectado: "pt", semFala: false });

    await rodarTranscrever();
    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/insta-sem-midia", "instagram");
  });

  /**
   * M5b, item 1: a rodada global (sem nichoId, o cron das 04:00) encadeia direto para
   * `extrair-sem-fala` ao terminar, em vez de esperar o horário fixo de reserva.
   */
  describe("M5b, item 1: a rodada global encadeia extrair-sem-fala", () => {
    afterEach(async () => {
      await db().execute(sql`delete from pgboss.job where name = ${FILAS.extrairSemFala}`);
    });

    it("sem nichoId (a rodada global), enfileira extrair-sem-fala ao terminar", async () => {
      await criarVideo("encadeamento-global", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
      vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

      await rodarTranscrever();

      const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrairSemFala} limit 1`);
      expect(jobs.rows.length).toBe(1);
    });

    it("com nichoId (a cadeia síncrona da primeira carga), não enfileira extrair-sem-fala", async () => {
      await criarVideo("encadeamento-por-nicho", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
      vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

      await rodarTranscrever(nichoId);

      const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrairSemFala} limit 1`);
      expect(jobs.rows.length).toBe(0);
    });
  });
});

/**
 * M5c (hotfix, achado da madrugada de 03/10/2026: o `transcrever` começou às 04:00 e às 07:00 ainda rodava, com 45 vídeos da
 * Dr.Wash, 3 do Bruno e zero da Overtake): o tempo limite por vídeo no `yt-dlp` (legenda e áudio) e na Groq, o orçamento de
 * tempo por setor, e a cadeia `extrair-sem-fala` disparando mesmo quando o job para pelo orçamento. O relógio do orçamento é
 * falso (cada transcrição "leva" 10 minutos): nenhum teste espera tempo de verdade.
 */
describe("rodarTranscrever, M5c: o tempo limite por vídeo", () => {
  const TRES_DIAS = 3 * DIA_MS;

  it("a legenda do YouTube pendurou (tempo limite): o vídeo falha com nova tentativa em 3 dias, o áudio nem é tentado, e o job segue para o próximo", async () => {
    await criarVideo("yt-legenda-lenta", { velocidadeRelativa: 5, publicadoEm: diasAtras(3) });
    await criarVideo("yt-depois-da-lenta", { velocidadeRelativa: 3, publicadoEm: diasAtras(3) });
    vi.mocked(baixarLegendaYoutube).mockImplementation(async (url: string) => {
      if (url.includes("yt-legenda-lenta")) throw new ErroLegendaTempoLimite("o yt-dlp passou de 90 s buscando a legenda (tempo limite por video)");
      return LEGENDA_LONGA;
    });

    const resumo = await rodarTranscrever();

    expect(resumo.falhas).toBe(1);
    expect(resumo.falhasPorTempoLimite).toBe(1);
    expect(resumo.falhasYoutubeBot).toBe(0);
    expect(resumo.transcritosPorLegenda).toBe(1);
    // O mesmo proxy, o mesmo YouTube: o áudio penduraria pelo mesmo motivo. Não gasta o limite uma segunda vez neste vídeo.
    expect(baixarAudio).not.toHaveBeenCalled();

    const [lenta] = await db().select().from(videos).where(eq(videos.idExterno, "yt-legenda-lenta"));
    expect(lenta.transcricao).toBeNull();
    const diferenca = lenta.proximaTentativaTranscricao!.getTime() - Date.now();
    expect(diferenca).toBeGreaterThan(TRES_DIAS - 60_000);
    expect(diferenca).toBeLessThan(TRES_DIAS + 60_000);
    const [seguinte] = await db().select().from(videos).where(eq(videos.idExterno, "yt-depois-da-lenta"));
    expect(seguinte.transcricao).toBe(LEGENDA_LONGA.trim());
  });

  it("o download do áudio pendurou (tempo limite): 3 dias, não os 7 da falha comum, contado à parte", async () => {
    await criarVideo("tiktok-audio-lento", { plataforma: "tiktok", foraDaCurva: 5, publicadoEm: diasAtras(10) });
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudioTempoLimite("o yt-dlp passou de 90 s baixando o audio (tempo limite por video)"));

    const resumo = await rodarTranscrever();

    expect(resumo.falhas).toBe(1);
    expect(resumo.falhasPorTempoLimite).toBe(1);
    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "tiktok-audio-lento"));
    expect(linha.transcricao).toBeNull();
    const diferenca = linha.proximaTentativaTranscricao!.getTime() - Date.now();
    expect(diferenca).toBeGreaterThan(TRES_DIAS - 60_000);
    expect(diferenca).toBeLessThan(TRES_DIAS + 60_000);
  });

  it("a Groq pendurou (tempo limite): 3 dias, e o áudio baixado é apagado mesmo assim", async () => {
    await criarVideo("tiktok-groq-lenta", { plataforma: "tiktok", foraDaCurva: 5, publicadoEm: diasAtras(10) });
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-groq-lenta.mp3");
    vi.mocked(transcreverAudio).mockRejectedValue(new ErroGroqTempoLimite("transcricao da Groq passou de 60 s (tempo limite)"));

    const resumo = await rodarTranscrever();

    expect(resumo.falhasPorTempoLimite).toBe(1);
    expect(apagarAudio).toHaveBeenCalledWith("/tmp/audio-groq-lenta.mp3");
    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "tiktok-groq-lenta"));
    expect(linha.transcricao).toBeNull();
    const diferenca = linha.proximaTentativaTranscricao!.getTime() - Date.now();
    expect(diferenca).toBeGreaterThan(TRES_DIAS - 60_000);
    expect(diferenca).toBeLessThan(TRES_DIAS + 60_000);
  });

  it("dez vídeos seguidos do YouTube pendurados é o proxy fora do ar: o mesmo freio do bloqueio, e o resto fica para a noite seguinte", async () => {
    config.regras.transcricoesPorDia = 40;
    const TOTAL = 12;
    for (let i = 0; i < TOTAL; i += 1) {
      await criarVideo(`yt-pendurado-${i}`, { velocidadeRelativa: TOTAL - i, publicadoEm: diasAtras(3), semDono: true });
    }
    vi.mocked(baixarLegendaYoutube).mockRejectedValue(new ErroLegendaTempoLimite("o yt-dlp passou de 90 s buscando a legenda (tempo limite por video)"));

    const resumo = await rodarTranscrever();

    expect(resumo.youtubePausado).toBe(true);
    expect(resumo.falhasPorTempoLimite).toBe(10);
    expect(baixarLegendaYoutube).toHaveBeenCalledTimes(10);
    // Os dois que nunca foram tentados continuam elegíveis (sem tentativa marcada) para a noite seguinte.
    const naoTentados = await db().select().from(videos).where(eq(videos.nichoId, nichoId));
    expect(naoTentados.filter((v) => v.proximaTentativaTranscricao === null)).toHaveLength(2);
  });

  it("um erro comum de download continua com os 7 dias de sempre (o tempo limite não mudou o resto)", async () => {
    await criarVideo("tiktok-falha-comum", { plataforma: "tiktok", foraDaCurva: 5, publicadoEm: diasAtras(10) });
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudio("video indisponivel"));

    const resumo = await rodarTranscrever();

    expect(resumo.falhas).toBe(1);
    expect(resumo.falhasPorTempoLimite).toBe(0);
    const [linha] = await db().select().from(videos).where(eq(videos.idExterno, "tiktok-falha-comum"));
    expect(linha.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(Date.now() + 6 * DIA_MS);
  });
});

describe("rodarTranscrever, M5c: o orçamento de tempo por setor e a cadeia", () => {
  const MIN = 60_000;
  let nicho2Id: number;
  let relogio = 0;
  const agora = () => relogio;

  /** Cada leitura de legenda "leva" 10 minutos do relógio falso; o resto não leva nada. */
  function legendaQueLeva10Minutos() {
    vi.mocked(baixarLegendaYoutube).mockImplementation(async () => {
      relogio += 10 * MIN;
      return LEGENDA_LONGA;
    });
  }

  async function criarVideoDoNicho(nichoDoVideo: number, idExterno: string, prioridade: number) {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId: null,
      nichoId: nichoDoVideo,
      views: 100,
      publicadoEm: diasAtras(3),
      velocidadeRelativa: String(prioridade),
      idioma: "pt",
    });
  }

  beforeAll(async () => {
    const [segundo] = await db().insert(nichos).values({ slug: "transcrever-teste-2", nome: "Transcrever teste 2", termos: [] }).returning();
    nicho2Id = segundo.id;
  });

  beforeEach(async () => {
    relogio = 0;
    config.regras.transcricoesPorDia = 10;
    await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, nicho2Id));
  });

  afterEach(async () => {
    await db().delete(videos).where(eq(videos.nichoId, nicho2Id));
    // Os testes de fora deste bloco rodam a rodada global: o segundo setor não pode ficar ativo para eles.
    await db().update(nichos).set({ ativo: false }).where(eq(nichos.id, nicho2Id));
    await db().execute(sql`delete from pgboss.job where name = ${FILAS.extrairSemFala}`);
  });

  async function transcritosDo(nichoDoVideo: number): Promise<number> {
    const linhas = await db().select().from(videos).where(eq(videos.nichoId, nichoDoVideo));
    return linhas.filter((v) => v.transcricao !== null).length;
  }

  async function tentativaMarcadaDo(nichoDoVideo: number): Promise<number> {
    const linhas = await db().select().from(videos).where(eq(videos.nichoId, nichoDoVideo));
    return linhas.filter((v) => v.proximaTentativaTranscricao !== null).length;
  }

  it("um setor lento para no orçamento, o que sobrou fica para a noite seguinte, e o segundo setor NÃO fica a zero (a madrugada de 03/10)", async () => {
    for (let i = 0; i < 6; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    for (let i = 0; i < 6; i += 1) await criarVideoDoNicho(nicho2Id, `b-${i}`, 10 - i);
    legendaQueLeva10Minutos();

    // 25 min por setor, 10 min por vídeo: cada setor lê 3 (confere o orçamento ANTES de cada vídeo: 0, 10 e 20 min passam; 30 não).
    const resumo = await rodarTranscrever(undefined, { agora, orcamentoPorSetorMs: 25 * MIN, orcamentoTotalMs: 600 * MIN });

    expect(await transcritosDo(nichoId)).toBe(3);
    expect(await transcritosDo(nicho2Id)).toBe(3);
    expect(resumo.transcritosPorLegenda).toBe(6);
    expect(resumo.setoresParadosPeloOrcamento).toEqual([
      { slug: "transcrever-teste", ficaramParaDepois: 3 },
      { slug: "transcrever-teste-2", ficaramParaDepois: 3 },
    ]);
    // O que ficou para depois não ganhou nova tentativa marcada: volta sozinho na fila da noite seguinte.
    expect(await tentativaMarcadaDo(nichoId)).toBe(0);
    expect(await tentativaMarcadaDo(nicho2Id)).toBe(0);
    expect(resumo.segundosPorSetor).toEqual({ "transcrever-teste": 30 * 60, "transcrever-teste-2": 30 * 60 });
  });

  it("o teto do job inteiro divide o que sobra pelos setores que faltam: o primeiro setor não come a parte do segundo", async () => {
    for (let i = 0; i < 6; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    for (let i = 0; i < 6; i += 1) await criarVideoDoNicho(nicho2Id, `b-${i}`, 10 - i);
    legendaQueLeva10Minutos();

    // Teto de 40 min para 2 setores, mesmo com 30 min "por setor": 20 min para o primeiro e os outros 20 para o segundo.
    const resumo = await rodarTranscrever(undefined, { agora, orcamentoPorSetorMs: 30 * MIN, orcamentoTotalMs: 40 * MIN });

    expect(await transcritosDo(nichoId)).toBe(2);
    expect(await transcritosDo(nicho2Id)).toBe(2);
    expect(resumo.transcritosPorLegenda).toBe(4);
    expect((resumo.setoresParadosPeloOrcamento as unknown[]).length).toBe(2);
  });

  it("sem estourar o orçamento, o setor lê tudo o que tem (até o teto diário) e nada é registrado como parado", async () => {
    for (let i = 0; i < 4; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    legendaQueLeva10Minutos();

    const resumo = await rodarTranscrever(nichoId, { agora, orcamentoPorSetorMs: 600 * MIN, orcamentoTotalMs: 600 * MIN });

    expect(await transcritosDo(nichoId)).toBe(4);
    expect(resumo.setoresParadosPeloOrcamento).toBeUndefined();
  });

  it("o orçamento zero (teto já gasto) não tenta vídeo nenhum, e nada é marcado como falha", async () => {
    for (let i = 0; i < 3; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    legendaQueLeva10Minutos();

    const resumo = await rodarTranscrever(nichoId, { agora, orcamentoPorSetorMs: 0, orcamentoTotalMs: 0 });

    expect(baixarLegendaYoutube).not.toHaveBeenCalled();
    expect(resumo.falhas).toBe(0);
    expect(await tentativaMarcadaDo(nichoId)).toBe(0);
    expect(resumo.setoresParadosPeloOrcamento).toEqual([{ slug: "transcrever-teste", ficaramParaDepois: 3 }]);
  });

  it("a cadeia dispara no fim da rodada global MESMO quando o job parou pelo orçamento", async () => {
    for (let i = 0; i < 6; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    legendaQueLeva10Minutos();

    const resumo = await rodarTranscrever(undefined, { agora, orcamentoPorSetorMs: 25 * MIN, orcamentoTotalMs: 600 * MIN });

    expect(resumo.setoresParadosPeloOrcamento).toBeDefined();
    const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrairSemFala}`);
    expect(jobs.rows.length).toBe(1);
  });

  it("a cadeia dispara também quando um erro inesperado interrompe o laço, e o erro continua subindo", async () => {
    for (let i = 0; i < 3; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    legendaQueLeva10Minutos();
    let chamadas = 0;
    const relogioQueQuebra = () => {
      chamadas += 1;
      if (chamadas >= 4) throw new Error("o relogio quebrou");
      return relogio;
    };

    await expect(rodarTranscrever(undefined, { agora: relogioQueQuebra, orcamentoPorSetorMs: 600 * MIN, orcamentoTotalMs: 600 * MIN })).rejects.toThrow("o relogio quebrou");

    const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrairSemFala}`);
    expect(jobs.rows.length).toBe(1);
  });

  it("a primeira carga de um setor (com nichoId) também respeita o orçamento e continua sem encadear", async () => {
    for (let i = 0; i < 6; i += 1) await criarVideoDoNicho(nichoId, `a-${i}`, 10 - i);
    legendaQueLeva10Minutos();

    const resumo = await rodarTranscrever(nichoId, { agora, orcamentoPorSetorMs: 25 * MIN, orcamentoTotalMs: 600 * MIN });

    expect(await transcritosDo(nichoId)).toBe(3);
    expect(resumo.setoresParadosPeloOrcamento).toEqual([{ slug: "transcrever-teste", ficaramParaDepois: 3 }]);
    const jobs = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.extrairSemFala}`);
    expect(jobs.rows.length).toBe(0);
  });
});
