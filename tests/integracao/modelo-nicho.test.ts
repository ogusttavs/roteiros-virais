/**
 * `rodarModeloNicho` (etapa 9): ciclo completo contra o Postgres real.
 * `AI_PROVIDER=mock` (`vitest.config.mts`) faz `gerarEstruturado` cair no
 * mock de `modeloNicho`, sem chamar a Anthropic de verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { modelosNicho, nichos, videos, type AnaliseVideo, type AnaliseVisual, type VideoAudio } from "@/db/schema";
import { rodarModeloNicho } from "@/jobs/modelo-nicho";
import { modeloNichoAtual } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

const ANALISE_PADRAO: AnaliseVideo = {
  assunto: "3 erros comuns",
  gancho: "voce ja passou por isso",
  estrutura: "gancho, explicacao, demonstracao, fechamento",
  fechamento: "resumo do que foi mostrado",
  chamadaFinal: "comenta se voce ja passou por isso",
  formato: "fala_para_camera",
  porQueFuncionou: "mostra o problema acontecendo de verdade",
};

const ANALISE_VISUAL_PADRAO: AnaliseVisual = {
  falaParaCamera: true,
  textoNaTela: [],
  cenario: "consultorio",
  ritmoDeCorte: "rapido",
  recursos: ["zoom"],
  momentoChave: { segundo: 4, oQue: "mostra o antes e depois" },
};

let nichoId: number;

async function criarVideo(
  idExterno: string,
  opcoes: {
    foraDaCurva?: number;
    publicadoEm: Date;
    analise?: AnaliseVideo;
    analiseVisual?: AnaliseVisual;
    audio?: VideoAudio;
    plataforma?: "youtube" | "tiktok" | "instagram";
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
      analise: opcoes.analise as never,
      analiseVisual: opcoes.analiseVisual as never,
      audio: opcoes.audio as never,
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "modelo-nicho-teste", nome: "Modelo nicho teste", termos: [] })
    .returning();
  nichoId = nicho.id;
});

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(modelosNicho).where(eq(modelosNicho.nichoId, nichoId));
});

describe("rodarModeloNicho", () => {
  it("sem nenhum video com analise, pula o nicho sem erro", async () => {
    const resumo = await rodarModeloNicho();
    expect(resumo.modelados).toBe(0);
    expect(resumo.semEvidencia).toBe(1);
    expect(resumo.falhas).toBe(0);

    expect(await modeloNichoAtual(nichoId)).toBeNull();
  });

  it("com evidencia, grava o modelo com a semana e baseadoEm", async () => {
    await criarVideo("com-analise-1", { foraDaCurva: 5, publicadoEm: diasAtras(10), analise: ANALISE_PADRAO });
    await criarVideo("com-analise-2", { foraDaCurva: 4, publicadoEm: diasAtras(20), analise: ANALISE_PADRAO });
    await criarVideo("com-analise-visual", {
      foraDaCurva: 6,
      publicadoEm: diasAtras(2),
      analise: ANALISE_PADRAO,
      analiseVisual: ANALISE_VISUAL_PADRAO,
    });

    const resumo = await rodarModeloNicho();
    expect(resumo.modelados).toBe(1);
    expect(resumo.semEvidencia).toBe(0);

    const atual = await modeloNichoAtual(nichoId);
    expect(atual).not.toBeNull();
    expect(atual!.modelo.baseadoEm).toBe(3);
    expect(atual!.modelo.resumo).toBeTruthy();
    expect(atual!.semana).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("video fora da janela de 12 semanas nao entra como evidencia", async () => {
    await criarVideo("fora-da-janela", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(100),
      analise: ANALISE_PADRAO,
    });

    const resumo = await rodarModeloNicho();
    expect(resumo.semEvidencia).toBe(1);
    expect(resumo.modelados).toBe(0);
  });

  it("audio da semana: conta os audios dos videos fora da curva (>= limiar) dos ultimos 7 dias, com empate e video sem audio", async () => {
    await criarVideo("evidencia-base", { foraDaCurva: 5, publicadoEm: diasAtras(5), analise: ANALISE_PADRAO });

    // dois videos com o mesmo audio "trend-a" (>= limiar, dentro dos 7 dias)
    await criarVideo("audio-a-1", {
      foraDaCurva: 4,
      publicadoEm: diasAtras(1),
      plataforma: "tiktok",
      audio: { id: "trend-a", nome: "audio A", autor: "criador A" },
    });
    await criarVideo("audio-a-2", {
      foraDaCurva: 4,
      publicadoEm: diasAtras(2),
      plataforma: "tiktok",
      audio: { id: "trend-a", nome: "audio A", autor: "criador A" },
    });
    // um video com outro audio, empatando em 1 com um audio sem par
    await criarVideo("audio-b-1", {
      foraDaCurva: 3,
      publicadoEm: diasAtras(3),
      plataforma: "instagram",
      audio: { id: "trend-b", nome: "audio B", autor: "criador B" },
    });
    // video fora da curva mas abaixo do limiar: nao conta
    await criarVideo("abaixo-do-limiar", {
      foraDaCurva: 1,
      publicadoEm: diasAtras(1),
      plataforma: "tiktok",
      audio: { id: "trend-c", nome: "audio C", autor: "criador C" },
    });
    // youtube nao expoe audio: sem erro, so fica de fora
    await criarVideo("youtube-sem-audio", {
      foraDaCurva: 8,
      publicadoEm: diasAtras(1),
      plataforma: "youtube",
    });

    const resumo = await rodarModeloNicho();
    expect(resumo.modelados).toBe(1);

    const atual = await modeloNichoAtual(nichoId);
    expect(atual!.audiosDaSemana).toHaveLength(2);
    expect(atual!.audiosDaSemana[0]).toMatchObject({ nome: "audio A", autor: "criador A", contagem: 2 });
    expect(atual!.audiosDaSemana[1]).toMatchObject({ nome: "audio B", autor: "criador B", contagem: 1 });
  });

  it("sem nenhum audio no banco (so youtube), a lista fica vazia sem erro", async () => {
    await criarVideo("so-youtube", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(2),
      analise: ANALISE_PADRAO,
      plataforma: "youtube",
    });

    const resumo = await rodarModeloNicho();
    expect(resumo.modelados).toBe(1);

    const atual = await modeloNichoAtual(nichoId);
    expect(atual!.audiosDaSemana).toEqual([]);
  });
});
