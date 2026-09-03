/**
 * Job `extrairColeta` (etapa 8, roda a parte, a cada poucas horas): busca os
 * lotes `em_andamento` de `lotes_ia`, confere se cada um terminou, e quando
 * terminou grava `analise` mais `etiquetas` nos videos do lote.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, videos, type AnaliseVideo } from "@/db/schema";
import { coletarResultadosLote, statusLote } from "@/ia/lote";
import * as extrairVideo from "@/ia/prompts/extrairVideo";
import { registrarGeracao } from "@/ia/registro";

export async function rodarExtrairColeta(): Promise<Record<string, unknown>> {
  const lotesPendentes = await db().select().from(lotesIa).where(eq(lotesIa.status, "em_andamento"));

  let lotesConcluidos = 0;
  let videosAtualizados = 0;
  let videosComErro = 0;
  const erros: string[] = [];

  for (const lote of lotesPendentes) {
    const status = await statusLote(lote.loteIdExterno);
    if (status !== "concluido") continue;

    const resultados = await coletarResultadosLote(lote.loteIdExterno, extrairVideo.schema);

    for (const resultado of resultados) {
      const videoId = Number(resultado.customId);

      if (resultado.status !== "sucesso") {
        videosComErro += 1;
        const motivo = resultado.status === "erro" ? resultado.motivo : "lote expirado";
        erros.push(`video ${videoId}: ${motivo}`);
        continue;
      }

      const { etiquetas, ...analise } = resultado.dados;
      const analiseVideo: AnaliseVideo = analise;

      await db().update(videos).set({ analise: analiseVideo, etiquetas }).where(eq(videos.id, videoId));
      videosAtualizados += 1;

      await registrarGeracao({
        tarefa: "extrairVideo",
        versaoPrompt: extrairVideo.versao,
        modelo: resultado.modelo,
        nivel: extrairVideo.nivel,
        entradas: { videoId },
        saida: resultado.dados,
        uso: {
          tokensEntrada: resultado.tokensEntrada,
          tokensSaida: resultado.tokensSaida,
          tokensCacheLeitura: 0,
          tokensCacheEscrita: 0,
        },
        emLote: true,
      });
    }

    await db()
      .update(lotesIa)
      .set({ status: "concluido", concluidoEm: new Date() })
      .where(eq(lotesIa.id, lote.id));
    lotesConcluidos += 1;
  }

  return {
    lotesPendentesAntes: lotesPendentes.length,
    lotesConcluidos,
    videosAtualizados,
    videosComErro,
    erros: erros.length > 0 ? erros : undefined,
  };
}
