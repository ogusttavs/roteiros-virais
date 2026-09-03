/**
 * Job `analisarVisual` (etapa 9, semanal, decisao 1 do `PROXIMO.md`): por
 * nicho, os 10 videos dos ultimos 7 dias com maior fora_da_curva que tem
 * transcricao e ainda nao tem analise_visual. Baixa o video em 480p, extrai
 * 8 quadros (`src/servicos/quadros.ts`) e manda a tarefa `analisarVisual`
 * (modelo forte, com imagem). Video que falha no download ou na extracao
 * de quadros nao derruba os outros (mesmo padrao de erro por item das
 * etapas 6 e 8), e fica registrado no resumo.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { nichos, videos, type AnaliseVisual } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as analisarVisualIA from "@/ia/prompts/analisarVisual";
import { registrarGeracao } from "@/ia/registro";
import { config } from "@/lib/config";
import { incluirSeed, PERTENCE_AO_NICHO } from "@/servicos/pesquisa";
import { temposDeQuadro } from "@/servicos/quadros";

import { apagarVideo, baixarVideo480p, extrairQuadros } from "./video";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

type CandidatoVisual = {
  id: number;
  url: string;
  titulo: string | null;
  transcricao: string | null;
  duracaoS: number | null;
};

async function candidatosDoNicho(nichoId: number): Promise<CandidatoVisual[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, new Date(Date.now() - SETE_DIAS_MS)),
    isNotNull(videos.foraDaCurva),
    isNotNull(videos.transcricao),
    isNotNull(videos.analise),
    isNull(videos.analiseVisual),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  return db()
    .select({
      id: videos.id,
      url: videos.url,
      titulo: videos.titulo,
      transcricao: videos.transcricao,
      duracaoS: videos.duracaoS,
    })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id))
    .limit(config.regras.visuaisPorSemana);
}

async function analisarUm(video: CandidatoVisual): Promise<void> {
  if (video.duracaoS === null) {
    throw new Error("video sem duracao conhecida, nao da para escolher os quadros");
  }

  let caminhoVideo: string | null = null;
  try {
    caminhoVideo = await baixarVideo480p(video.url);
    const quadros = await extrairQuadros(caminhoVideo, temposDeQuadro(video.duracaoS));

    const resultado = await gerarEstruturado({
      tarefa: "analisarVisual",
      nivel: analisarVisualIA.nivel,
      effort: analisarVisualIA.esforco,
      schema: analisarVisualIA.schema,
      sistemaEstavel: analisarVisualIA.montarSistemaEstavel(),
      entrada: analisarVisualIA.montarEntrada({
        titulo: video.titulo ?? "",
        duracaoS: video.duracaoS,
        transcricao: video.transcricao ?? "",
      }),
      imagens: quadros.map((quadro) => ({ base64: quadro.base64, mediaType: "image/jpeg" as const })),
    });

    const analiseVisual: AnaliseVisual = resultado.dados;
    await db().update(videos).set({ analiseVisual }).where(eq(videos.id, video.id));

    await registrarGeracao({
      tarefa: "analisarVisual",
      versaoPrompt: analisarVisualIA.versao,
      modelo: resultado.modelo,
      nivel: analisarVisualIA.nivel,
      entradas: { videoId: video.id },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });
  } finally {
    if (caminhoVideo) await apagarVideo(caminhoVideo);
  }
}

export async function rodarAnalisarVisual(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let analisados = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const candidatos = await candidatosDoNicho(nicho.id);

    for (const video of candidatos) {
      try {
        await analisarUm(video);
        analisados += 1;
      } catch (erro) {
        falhas += 1;
        erros.push(`video ${video.id} / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  return {
    nichos: nichosAtivos.length,
    analisados,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
