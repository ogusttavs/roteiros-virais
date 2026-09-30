/**
 * `rodarExtrairAgora` (M1, item 1: o setor novo não pode esperar o lote). Contra o Postgres
 * real; `AI_PROVIDER=mock` já garantido pelo `vitest.config.mts`.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { lotesIa, nichos, videos } from "@/db/schema";
import { rodarExtrair } from "@/jobs/extrair";
import { LIMITE_ANALISADOS_SETOR_NOVO, LIMITE_CANDIDATOS_IMEDIATO, rodarExtrairAgora } from "@/jobs/extrair-agora";
import { rodarExtrairColeta } from "@/jobs/extrair-coleta";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoNovoId: number;
let nichoEstabelecidoId: number;

const TRANSCRICAO_BOA =
  "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.";

const ANALISE_EXEMPLO = {
  assunto: "ja analisado",
  gancho: "x",
  estrutura: "x",
  fechamento: "x",
  chamadaFinal: "x",
  formato: "outro" as const,
  porQueFuncionou: "x",
};

async function criarVideo(
  nichoId: number,
  idExterno: string,
  opcoes: { transcricao?: string; analise?: unknown; foraDaCurva?: string; duracaoS?: number } = {},
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
      transcricao: opcoes.transcricao,
      analise: opcoes.analise as never,
      foraDaCurva: opcoes.foraDaCurva,
      duracaoS: opcoes.duracaoS,
    })
    .returning();
  return v;
}

async function estabelecerNicho(nichoId: number) {
  const linhas = Array.from({ length: LIMITE_ANALISADOS_SETOR_NOVO }, (_, i) => ({
    plataforma: "youtube" as const,
    idExterno: `ja-estabelecido-${nichoId}-${i}`,
    url: `https://exemplo.invalido/ja-estabelecido-${nichoId}-${i}`,
    nichoId,
    titulo: `[exemplo] ja estabelecido ${i}`,
    views: 100,
    transcricao: "video ja analisado, so para o setor nao contar como novo",
    analise: ANALISE_EXEMPLO as never,
  }));
  await db().insert(videos).values(linhas);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nichoNovo] = await db()
    .insert(nichos)
    .values({ slug: "extrair-agora-novo", nome: "Extrair agora novo", termos: [] })
    .returning();
  nichoNovoId = nichoNovo.id;
  const [nichoEstabelecido] = await db()
    .insert(nichos)
    .values({ slug: "extrair-agora-estabelecido", nome: "Extrair agora estabelecido", termos: [] })
    .returning();
  nichoEstabelecidoId = nichoEstabelecido.id;
});

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoNovoId));
  await db().delete(videos).where(eq(videos.nichoId, nichoEstabelecidoId));
  await db().delete(lotesIa);
});

describe("rodarExtrairAgora", () => {
  it("setor com menos de 20 vídeos analisados analisa na hora, sem lote", async () => {
    const video = await criarVideo(nichoNovoId, "video-do-setor-novo", { transcricao: TRANSCRICAO_BOA });

    const resumo = await rodarExtrairAgora(nichoNovoId);
    expect(resumo.setoresNovos).toBe(1);
    expect(resumo.videosAnalisados).toBe(1);

    const [atualizado] = await db().select().from(videos).where(eq(videos.id, video.id));
    expect(atualizado.analise).not.toBeNull();
    expect(atualizado.analise!.assunto).toBeTruthy();
    expect(atualizado.etiquetas.length).toBeGreaterThan(0);

    const lotes = await db().select().from(lotesIa);
    expect(lotes).toHaveLength(0);
  });

  it("setor com 20 ou mais vídeos analisados não entra no caminho imediato", async () => {
    await estabelecerNicho(nichoEstabelecidoId);
    const video = await criarVideo(nichoEstabelecidoId, "video-do-setor-estabelecido", { transcricao: TRANSCRICAO_BOA });

    const resumo = await rodarExtrairAgora(nichoEstabelecidoId);
    expect(resumo.setoresNovos).toBe(0);
    expect(resumo.videosAnalisados).toBe(0);

    const [intocado] = await db().select().from(videos).where(eq(videos.id, video.id));
    expect(intocado.analise).toBeNull();
  });

  it("transcricao curta demais nao entra no caminho imediato, ganha nova tentativa de transcricao", async () => {
    const curto = await criarVideo(nichoNovoId, "curto", { transcricao: "E ai" });

    const resumo = await rodarExtrairAgora();
    expect(resumo.videosAnalisados).toBe(0);
    expect(resumo.transcricaoCurtaDemais).toBe(1);

    const [atualizado] = await db().select().from(videos).where(eq(videos.id, curto.id));
    expect(atualizado.analise).toBeNull();
    expect(atualizado.proximaTentativaTranscricao).not.toBeNull();
  });

  it("video mais longo que o teto de duracao (hotfix #72) fica de fora", async () => {
    const longo = await criarVideo(nichoNovoId, "video-longo", {
      transcricao: TRANSCRICAO_BOA,
      duracaoS: config.regras.tetoDuracaoReferenciaS + 60,
    });
    const curto = await criarVideo(nichoNovoId, "video-curto", { transcricao: TRANSCRICAO_BOA, duracaoS: 45 });

    const resumo = await rodarExtrairAgora();
    expect(resumo.videosAnalisados).toBe(1);

    const [videoLongo] = await db().select().from(videos).where(eq(videos.id, longo.id));
    expect(videoLongo.analise).toBeNull();
    const [videoCurto] = await db().select().from(videos).where(eq(videos.id, curto.id));
    expect(videoCurto.analise).not.toBeNull();
  });

  it("no maximo LIMITE_CANDIDATOS_IMEDIATO por rodada, os de maior multiplo primeiro", async () => {
    for (let i = 0; i < LIMITE_CANDIDATOS_IMEDIATO + 5; i++) {
      await criarVideo(nichoNovoId, `candidato-${i}`, {
        transcricao: TRANSCRICAO_BOA,
        foraDaCurva: String(i), // o de indice mais alto tem o maior multiplo
      });
    }

    const resumo = await rodarExtrairAgora();
    expect(resumo.videosAnalisados).toBe(LIMITE_CANDIDATOS_IMEDIATO);

    // os 5 de menor multiplo (0 a 4) ficam de fora desta rodada.
    const [ficouDeFora] = await db().select().from(videos).where(eq(videos.idExterno, "candidato-0"));
    expect(ficouDeFora.analise).toBeNull();
    const [entrou] = await db()
      .select()
      .from(videos)
      .where(eq(videos.idExterno, `candidato-${LIMITE_CANDIDATOS_IMEDIATO + 4}`));
    expect(entrou.analise).not.toBeNull();
  });

  it("chamado com um nichoId, so mexe naquele setor", async () => {
    const doNovo = await criarVideo(nichoNovoId, "so-este-setor", { transcricao: TRANSCRICAO_BOA });

    const resumo = await rodarExtrairAgora(nichoNovoId);
    expect(resumo.setoresNovos).toBe(1);

    const [atualizado] = await db().select().from(videos).where(eq(videos.id, doNovo.id));
    expect(atualizado.analise).not.toBeNull();
  });
});

describe("rodarExtrair, o caminho imediato e o lote juntos", () => {
  it("setor novo vai pelo caminho imediato, setor estabelecido vai no lote, nenhum video nos dois", async () => {
    await estabelecerNicho(nichoEstabelecidoId);
    const videoNovo = await criarVideo(nichoNovoId, "vai-pelo-imediato", { transcricao: TRANSCRICAO_BOA });
    const videoLote = await criarVideo(nichoEstabelecidoId, "vai-pelo-lote", { transcricao: TRANSCRICAO_BOA });

    const resumo = await rodarExtrair();

    // o setor novo ja saiu analisado do caminho imediato, entao o lote so tem o do setor estabelecido.
    expect(resumo.videosNoLote).toBe(1);
    const [lote] = await db().select().from(lotesIa);
    expect(lote.videoIds).toEqual([videoLote.id]);

    const [analisadoNaHora] = await db().select().from(videos).where(eq(videos.id, videoNovo.id));
    expect(analisadoNaHora.analise).not.toBeNull();

    // o do lote so ganha analise depois de rodarExtrairColeta.
    const [aindaSemAnalise] = await db().select().from(videos).where(eq(videos.id, videoLote.id));
    expect(aindaSemAnalise.analise).toBeNull();

    await rodarExtrairColeta();
    const [analisadoPeloLote] = await db().select().from(videos).where(eq(videos.id, videoLote.id));
    expect(analisadoPeloLote.analise).not.toBeNull();
  });
});
