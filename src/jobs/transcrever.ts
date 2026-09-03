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
    return { selecionados: [] as number[], porId: new Map<number, { url: string; plataforma: string }>() };
  }

  const linhas = await db()
    .select({
      id: videos.id,
      url: videos.url,
      plataforma: videos.plataforma,
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

  const porId = new Map(linhas.map((l) => [l.id, { url: l.url, plataforma: l.plataforma }]));
  return { selecionados, porId };
}

type ResultadoVideo =
  | { tipo: "legenda" | "groq" | "pulado" }
  | { tipo: "falhou"; motivo: string };

async function transcreverUm(videoId: number, url: string, plataforma: string): Promise<ResultadoVideo> {
  if (plataforma === "youtube") {
    const legenda = await baixarLegendaYoutube(url);
    if (legenda) {
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
    return { tipo: "groq" };
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
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const { selecionados, porId } = await candidatosDoNicho(nicho.id, config.regras.transcricoesPorDia);

    for (const videoId of selecionados) {
      const info = porId.get(videoId);
      if (!info) continue;

      try {
        const resultado = await transcreverUm(videoId, info.url, info.plataforma);
        if (resultado.tipo === "legenda") porLegenda += 1;
        else if (resultado.tipo === "groq") porGroq += 1;
        else if (resultado.tipo === "pulado") pulados += 1;
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
    erros: erros.length > 0 ? erros : undefined,
  };
}
