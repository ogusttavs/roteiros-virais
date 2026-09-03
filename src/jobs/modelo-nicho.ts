/**
 * Job `modeloNicho` (etapa 9, semanal, decisoes 2 e 3 do `PROXIMO.md`,
 * depois de `analisarVisual`): por nicho, junta os videos fora da curva das
 * ultimas 12 semanas com `analise` (ate `videosParaModeloNicho`, os de
 * maior fora_da_curva primeiro) mais os que tem `analise_visual` na
 * semana, e chama a tarefa `modeloNicho` (modelo forte, cache de prompt no
 * bloco estavel). O audio da semana e matematica pura, calculada antes da
 * IA (nunca gerada pelo modelo) e gravada em `modelos_nicho.audios_da_semana`.
 * Grava com `semana` = segunda-feira ISO da data. Sem evidencia (nenhum
 * video com analise no nicho ainda), pula o nicho sem erro.
 */
import { and, asc, desc, eq, gte, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { modelosNicho, nichos, videos, type AnaliseVideo, type AnaliseVisual, type ModeloNicho } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as modeloNichoIA from "@/ia/prompts/modeloNicho";
import { registrarGeracao } from "@/ia/registro";
import { config } from "@/lib/config";
import { segundaFeiraIso } from "@/lib/semana";
import { contarAudiosDaSemana } from "@/servicos/audio-da-semana";
import { incluirSeed } from "@/servicos/pesquisa";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const DOZE_SEMANAS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

async function videosComAnalise(nichoId: number) {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, new Date(Date.now() - DOZE_SEMANAS_MS)),
    isNotNull(videos.foraDaCurva),
    isNotNull(videos.analise),
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  return db()
    .select({ id: videos.id, analise: videos.analise })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id))
    .limit(config.regras.videosParaModeloNicho) as Promise<{ id: number; analise: AnaliseVideo | null }[]>;
}

async function videosComAnaliseVisual(nichoId: number) {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, new Date(Date.now() - SETE_DIAS_MS)),
    isNotNull(videos.analiseVisual),
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  return db()
    .select({ id: videos.id, analiseVisual: videos.analiseVisual })
    .from(videos)
    .where(and(...condicoes)) as Promise<{ id: number; analiseVisual: AnaliseVisual | null }[]>;
}

async function videosParaAudioDaSemana(nichoId: number) {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, new Date(Date.now() - SETE_DIAS_MS)),
    gte(videos.foraDaCurva, String(config.regras.limiarForaDaCurva)),
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  return db()
    .select({ id: videos.id, audio: videos.audio })
    .from(videos)
    .where(and(...condicoes));
}

async function modelarNicho(nicho: { id: number; slug: string }): Promise<"modelado" | "sem_evidencia"> {
  const [comAnalise, comAnaliseVisual, paraAudio] = await Promise.all([
    videosComAnalise(nicho.id),
    videosComAnaliseVisual(nicho.id),
    videosParaAudioDaSemana(nicho.id),
  ]);

  if (comAnalise.length === 0) return "sem_evidencia";

  const audiosDaSemana = contarAudiosDaSemana(paraAudio);

  const resultado = await gerarEstruturado({
    tarefa: "modeloNicho",
    nivel: modeloNichoIA.nivel,
    effort: modeloNichoIA.esforco,
    schema: modeloNichoIA.schema,
    sistemaEstavel: modeloNichoIA.montarSistemaEstavel(),
    entrada: modeloNichoIA.montarEntrada({
      videosAnalisados: comAnalise
        .filter((v): v is { id: number; analise: AnaliseVideo } => v.analise !== null)
        .map((v) => ({
          id: v.id,
          assunto: v.analise.assunto,
          gancho: v.analise.gancho,
          estrutura: v.analise.estrutura,
          fechamento: v.analise.fechamento,
          chamadaFinal: v.analise.chamadaFinal,
          formato: v.analise.formato,
        })),
      analisesVisuais: comAnaliseVisual
        .filter((v): v is { id: number; analiseVisual: AnaliseVisual } => v.analiseVisual !== null)
        .map((v) => ({ id: v.id, ritmoDeCorte: v.analiseVisual.ritmoDeCorte, recursos: v.analiseVisual.recursos })),
    }),
  });

  const modelo: ModeloNicho = { ...resultado.dados, baseadoEm: comAnalise.length };

  await db().insert(modelosNicho).values({
    nichoId: nicho.id,
    semana: segundaFeiraIso(),
    modelo,
    audiosDaSemana,
  });

  await registrarGeracao({
    tarefa: "modeloNicho",
    versaoPrompt: modeloNichoIA.versao,
    modelo: resultado.modelo,
    nivel: modeloNichoIA.nivel,
    entradas: { nichoId: nicho.id, videosAnalisados: comAnalise.length, analisesVisuais: comAnaliseVisual.length },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  return "modelado";
}

export async function rodarModeloNicho(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let modelados = 0;
  let semEvidencia = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    try {
      const resultado = await modelarNicho(nicho);
      if (resultado === "modelado") modelados += 1;
      else semEvidencia += 1;
    } catch (erro) {
      falhas += 1;
      erros.push(`nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    nichos: nichosAtivos.length,
    modelados,
    semEvidencia,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
