/**
 * Job `transcrever` (etapa 8, diario, depois de `pontuar`): ler o que foi
 * dito nos videos que passaram no filtro (escopo 5.5, camada 2). Para
 * YouTube, tenta a legenda automatica primeiro (gratis); se nao tiver
 * legenda no idioma, ou para as outras plataformas, baixa o audio e
 * transcreve na Groq. Sem `GROQ_API_KEY`, so a legenda do YouTube roda
 * (`.env.example`); nenhum video de outra plataforma e sequer tentado, e
 * isso nao conta como falha (nao marca `proximaTentativaTranscricao`).
 */
import { eq, inArray } from "drizzle-orm";

import { PRECO_GROQ_USD_POR_HORA } from "@/config/precos-ia";
import { db } from "@/db";
import { nichos, videos } from "@/db/schema";
import { apagarAudio, baixarAudio, ErroAudio } from "@/jobs/audio";
import { baixarLegendaYoutube } from "@/jobs/legendas-youtube";
import { config } from "@/lib/config";
import { foraDaCurvaDoNicho, subindoHoje } from "@/servicos/pesquisa";
import { selecionarParaTranscrever, type VideoParaSelecionar } from "@/servicos/selecionar-transcricao";

import { ErroGroq, transcreverAudio } from "./groq-api";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

async function candidatosDoNicho(nichoId: number, limite: number) {
  const [prioritarios, estruturais] = await Promise.all([
    subindoHoje(nichoId, limite),
    foraDaCurvaDoNicho(nichoId, 90, limite),
  ]);

  const idsUnicos = [...new Set([...prioritarios.map((v) => v.id), ...estruturais.map((v) => v.id)])];
  if (idsUnicos.length === 0) {
    return {
      selecionados: [] as number[],
      porId: new Map<number, { url: string; plataforma: string; duracaoS: number | null }>(),
    };
  }

  const linhas = await db()
    .select({
      id: videos.id,
      url: videos.url,
      plataforma: videos.plataforma,
      duracaoS: videos.duracaoS,
      transcricao: videos.transcricao,
      proximaTentativaTranscricao: videos.proximaTentativaTranscricao,
    })
    .from(videos)
    .where(inArray(videos.id, idsUnicos));

  const candidatos: VideoParaSelecionar[] = linhas.map((l) => ({
    id: l.id,
    temTranscricao: Boolean(l.transcricao),
    proximaTentativaTranscricao: l.proximaTentativaTranscricao,
  }));

  const selecionados = selecionarParaTranscrever(
    prioritarios.map((v) => v.id),
    estruturais.map((v) => v.id),
    candidatos,
    limite,
    new Date(),
  );

  const porId = new Map(linhas.map((l) => [l.id, { url: l.url, plataforma: l.plataforma, duracaoS: l.duracaoS }]));
  return { selecionados, porId };
}

type ResultadoVideo =
  | { tipo: "legenda" | "pulado" }
  | { tipo: "groq"; duracaoS: number | null }
  | { tipo: "falhou"; motivo: string };

/**
 * Legenda automatica curta demais ("E ai", ou uma legenda confusa que virou
 * poucas palavras depois de interpretarVtt) nao carrega informacao o
 * bastante; tratada como "sem legenda" e cai para audio mais Groq (achado
 * da revisao da etapa 8, calibrar depois com mais exemplos reais).
 */
const TAMANHO_MINIMO_LEGENDA = 200;

async function transcreverUm(
  videoId: number,
  url: string,
  plataforma: string,
  duracaoS: number | null,
): Promise<ResultadoVideo> {
  if (plataforma === "youtube") {
    const legenda = await baixarLegendaYoutube(url);
    if (legenda && legenda.length >= TAMANHO_MINIMO_LEGENDA) {
      await db().update(videos).set({ transcricao: legenda }).where(eq(videos.id, videoId));
      return { tipo: "legenda" };
    }
  }

  if (!config.transcricao.groqKey) {
    return { tipo: "pulado" };
  }

  let caminhoAudio: string | null = null;
  try {
    caminhoAudio = await baixarAudio(url);
    const texto = await transcreverAudio(caminhoAudio);
    await db().update(videos).set({ transcricao: texto }).where(eq(videos.id, videoId));
    return { tipo: "groq", duracaoS };
  } catch (erro) {
    if (erro instanceof ErroAudio || erro instanceof ErroGroq) {
      await db()
        .update(videos)
        .set({ proximaTentativaTranscricao: new Date(Date.now() + SETE_DIAS_MS) })
        .where(eq(videos.id, videoId));
      return { tipo: "falhou", motivo: erro.message };
    }
    throw erro;
  } finally {
    if (caminhoAudio) await apagarAudio(caminhoAudio);
  }
}

export async function rodarTranscrever(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let porLegenda = 0;
  let porGroq = 0;
  let pulados = 0;
  let falhas = 0;
  let segundosAudioGroq = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const { selecionados, porId } = await candidatosDoNicho(nicho.id, config.regras.transcricoesPorDia);

    for (const videoId of selecionados) {
      const info = porId.get(videoId);
      if (!info) continue;

      try {
        const resultado = await transcreverUm(videoId, info.url, info.plataforma, info.duracaoS);
        if (resultado.tipo === "legenda") porLegenda += 1;
        else if (resultado.tipo === "groq") {
          porGroq += 1;
          segundosAudioGroq += resultado.duracaoS ?? 0;
        } else if (resultado.tipo === "pulado") pulados += 1;
        else if (resultado.tipo === "falhou") {
          falhas += 1;
          erros.push(`video ${videoId} / nicho "${nicho.slug}": ${resultado.motivo}`);
        }
      } catch (erro) {
        falhas += 1;
        erros.push(`video ${videoId} / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  return {
    nichos: nichosAtivos.length,
    transcritosPorLegenda: porLegenda,
    transcritosPorGroq: porGroq,
    puladosSemChaveGroq: pulados,
    falhas,
    segundosAudioGroq,
    custoEstimadoGroqUsd: Number(((segundosAudioGroq / 3600) * PRECO_GROQ_USD_POR_HORA).toFixed(4)),
    erros: erros.length > 0 ? erros : undefined,
  };
}
