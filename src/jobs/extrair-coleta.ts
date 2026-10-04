/**
 * Job `extrairColeta` (etapa 8, roda a parte, a cada poucas horas): busca os
 * lotes `em_andamento` de `lotes_ia`, confere se cada um terminou, e quando
 * terminou grava `analise` mais `etiquetas` nos videos do lote.
 *
 * Idioma (acabamento visual 2, achado do Gustavo no iPad): a analise que
 * nao passa na checagem barata de `src/lib/idioma.ts` ganha uma segunda
 * tentativa, sincrona (fora do lote, so para este video), com a instrucao
 * de traducao reforcada. Reprovou de novo, grava a melhor das duas mesmo
 * assim (revisao do PR #30: analise nenhuma e pior que uma com um campo em
 * ingles) e conta no resumo do job; nunca deixa o video sem analise por
 * causa disto.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, videos } from "@/db/schema";
import { coletarResultadosLote, statusLote } from "@/ia/lote";
import * as extrairVideo from "@/ia/prompts/extrairVideo";
import { registrarGeracao } from "@/ia/registro";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";

import { aplicarResultadoExtracao, resolverIdioma } from "./extracao-comum";

export async function rodarExtrairColeta(): Promise<Record<string, unknown>> {
  const lotesPendentes = await db().select().from(lotesIa).where(eq(lotesIa.status, "em_andamento"));

  let lotesConcluidos = 0;
  let videosAtualizados = 0;
  let semFormato = 0;
  let semFicha = 0;
  let videosComErro = 0;
  let reprovadosPorIdioma = 0;
  const erros: string[] = [];
  /** M1, item 2: os setores que ganharam análise nova nesta rodada, para enfileirar `temasDoDia` só para eles. */
  const nichosAfetados = new Set<number>();

  for (const lote of lotesPendentes) {
    const status = await statusLote(lote.loteIdExterno);
    if (status !== "concluido") continue;

    const resultados = await coletarResultadosLote(lote.loteIdExterno, extrairVideo.schema);
    const nichoPorVideoId = new Map(
      (
        await db()
          .select({ id: videos.id, nichoId: videos.nichoId })
          .from(videos)
          .where(inArray(videos.id, resultados.map((r) => Number(r.customId))))
      ).map((v) => [v.id, v.nichoId]),
    );

    for (const resultado of resultados) {
      const videoId = Number(resultado.customId);

      if (resultado.status !== "sucesso") {
        videosComErro += 1;
        const motivo = resultado.status === "erro" ? resultado.motivo : "lote expirado";
        erros.push(`video ${videoId}: ${motivo}`);
        continue;
      }

      const { dados, reprovadoPorIdioma } = await resolverIdioma(videoId, resultado.dados);
      if (reprovadoPorIdioma) {
        // As duas tentativas reprovaram (ou a retentativa nao rodou, sem
        // transcricao para reconstruir a entrada): fica com a que passa em
        // mais campos, nunca descarta a analise (revisao do PR #30).
        reprovadosPorIdioma += 1;
        erros.push(`video ${videoId}: analise reprovada na checagem de idioma depois de refazer`);
      }

      await aplicarResultadoExtracao(videoId, dados);
      videosAtualizados += 1;
      if (dados.formatoCatalogo === null) semFormato += 1;
      if (dados.fichaCatalogo === null) semFicha += 1;
      const nichoId = nichoPorVideoId.get(videoId);
      if (nichoId !== null && nichoId !== undefined) nichosAfetados.add(nichoId);

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

  // E44 PR 1: o modelo devolveu um tipo fora da lista (ou nenhum): `formato_catalogo` ficou nulo, e o vídeo segue a regra antiga até a reclassificação.
  if (semFicha > 0) logger.warn({ semFicha, deVideos: videosAtualizados }, "extrair-coleta: videos cuja ficha_catalogo ficou nula (valor fora da lista ou ausente)");
  if (semFormato > 0) logger.warn({ semFormato, deVideos: videosAtualizados }, "extrair-coleta: videos cujo formato_catalogo ficou nulo (valor fora da lista ou ausente)");

  /**
   * M1, item 2: o tema nasce quando a análise chega, não só às 06:30. `temasDoDia` com
   * `nichoId` só gera para este setor, e só se ele ainda não tem tema hoje (o próprio job
   * confere e pula, para nunca regenerar o tema de quem já escolheu). A fila nunca derruba a
   * extração (mesma regra de `reprovarERescrever`, E27 parte 2): se o pg-boss estiver fora do
   * ar, o erro fica só no log.
   */
  for (const nichoId of nichosAfetados) {
    try {
      await garantirBossPronto();
      await boss().send(FILAS.temasDoDia, { nichoId });
    } catch (erro) {
      logger.error({ err: erro, nichoId }, "nao foi possivel enfileirar temas-do-dia depois do lote de extracao");
    }
  }

  return {
    lotesPendentesAntes: lotesPendentes.length,
    lotesConcluidos,
    videosAtualizados,
    videosComErro,
    reprovadosPorIdioma,
    nichosComTemaEnfileirado: nichosAfetados.size,
    erros: erros.length > 0 ? erros : undefined,
  };
}
