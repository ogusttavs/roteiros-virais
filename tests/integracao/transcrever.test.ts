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

  it("video do YouTube sem legenda cai para audio mais Groq, e o resumo acumula o custo", async () => {
    const atualizadoAntes = diasAtras(5);
    await criarVideo("yt-sem-legenda", {
      velocidadeRelativa: 3,
      publicadoEm: diasAtras(3),
      duracaoS: 600,
      atualizadoEm: atualizadoAntes,
    });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito pela groq");

    const resumo = await rodarTranscrever();
    expect(resumo.transcritosPorGroq).toBe(1);
    expect(apagarAudio).toHaveBeenCalledWith("/tmp/audio-fake.mp3");
    expect(resumo.segundosAudioGroq).toBe(600);
    expect(resumo.custoEstimadoGroqUsd).toBeCloseTo((600 / 3600) * 0.04, 4);

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
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito pela groq");

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
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito pela groq");

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
describe("rodarTranscrever, V2b item 6: proporcao 70/30 na fila", () => {
  it("video internacional em excesso nunca entra na fila, mesmo com prioridade maior que o brasileiro que entrou", async () => {
    // FATOR_FILA (fixo, transcrever.ts) = 4; teto diario 5 => tamanhoFila = 20.
    // Cinco "pt" disponiveis => brasileirosAceitos = 5; maxInternacional =
    // floor(5*0,3/0,7) = 2 (nao mais um calculo sobre a fila de 20). Dez "en"
    // com prioridade maior (foraDaCurva mais alto) que os cinco "pt": so os
    // 2 primeiros "en" cabem na fila, os outros oito ficam de fora, mesmo
    // tendo prioridade maior que qualquer "pt".
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
    // Os dois "en" de maior prioridade entraram (cabem no teto de 2 internacionais).
    expect(chamadas).toEqual(expect.arrayContaining(urlsEn.slice(0, 2)));
    // Do terceiro "en" em diante, nenhum entrou na fila, mesmo com prioridade
    // maior que qualquer "pt": a proporcao cortou antes deles.
    for (const url of urlsEn.slice(2)) {
      expect(chamadas).not.toContain(url);
    }
    // Os "pt" completam o teto de 5 sucessos (2 en + 3 pt primeiros).
    expect(chamadas).toEqual(expect.arrayContaining(urlsPt.slice(0, 3)));
  });

  /** A nova regra: sem nenhum brasileiro disponivel, a fila fica vazia, nunca so internacional. */
  it("sem nenhum brasileiro disponivel, a fila fica vazia: nenhum internacional e tentado", async () => {
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

    expect(baixarLegendaYoutube).not.toHaveBeenCalled();
    expect((resumo.tentativas as Record<string, number>).youtube).toBe(0);
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
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito");

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
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito");

    await rodarTranscrever();
    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/insta-vencido", "instagram");
    expect(baixarAudio).not.toHaveBeenCalledWith(midiaUrl, expect.anything());
  });

  it("sem midiaUrl nenhuma, usa a url da pagina normalmente", async () => {
    await criarVideo("insta-sem-midia", { plataforma: "instagram", foraDaCurva: 5, publicadoEm: diasAtras(10) });
    vi.mocked(baixarAudio).mockResolvedValue("/tmp/audio-fake.mp3");
    vi.mocked(transcreverAudio).mockResolvedValue("texto transcrito");

    await rodarTranscrever();
    expect(baixarAudio).toHaveBeenCalledWith("https://exemplo.invalido/insta-sem-midia", "instagram");
  });
});
