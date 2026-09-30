/**
 * Job `extrair` (etapa 8, diario, depois de `transcrever`): monta um lote
 * com a tarefa `extrairVideo` (modelo barato, pela API de lote) para todo
 * video com `transcricao` e sem `analise`. A API de lote e assincrona (ate
 * 24h); `extrairColeta` (job separado) e quem busca o resultado quando
 * pronto.
 *
 * M1, item 1: antes de montar o lote, `rodarExtrairAgora()` analisa na hora
 * os setores com menos de 20 vídeos analisados (sem lote, um a um). Um
 * vídeo nunca vai pelos dois caminhos: os que ganham `analise` ali somem
 * desta consulta, que já filtra `isNull(videos.analise)`.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, nichos, videos } from "@/db/schema";
import { criarLote, type ItemLote } from "@/ia/lote";
import * as extrairVideo from "@/ia/prompts/extrairVideo";

import { TAMANHO_MINIMO_TRANSCRICAO } from "./extracao-comum";
import { rodarExtrairAgora } from "./extrair-agora";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export async function rodarExtrair(): Promise<Record<string, unknown>> {
  const imediato = await rodarExtrairAgora();

  const candidatos = await db()
    .select({
      id: videos.id,
      titulo: videos.titulo,
      transcricao: videos.transcricao,
      nomeNicho: nichos.nome,
      termosNicho: nichos.termos,
    })
    .from(videos)
    .innerJoin(nichos, eq(videos.nichoId, nichos.id))
    .where(and(isNotNull(videos.transcricao), isNull(videos.analise)));

  const curtos = candidatos.filter((v) => (v.transcricao ?? "").trim().length < TAMANHO_MINIMO_TRANSCRICAO);
  const prontos = candidatos.filter((v) => (v.transcricao ?? "").trim().length >= TAMANHO_MINIMO_TRANSCRICAO);

  if (curtos.length > 0) {
    await db()
      .update(videos)
      .set({ proximaTentativaTranscricao: new Date(Date.now() + SETE_DIAS_MS) })
      .where(
        inArray(
          videos.id,
          curtos.map((v) => v.id),
        ),
      );
  }

  if (prontos.length === 0) {
    return { videosNoLote: 0, transcricaoCurtaDemais: curtos.length, imediato };
  }

  const itens: ItemLote<extrairVideo.SaidaExtrairVideo>[] = prontos.map((v) => ({
    customId: String(v.id),
    tarefa: "extrairVideo",
    nivel: extrairVideo.nivel,
    schema: extrairVideo.schema,
    sistemaEstavel: extrairVideo.montarSistemaEstavel(),
    entrada: extrairVideo.montarEntrada({
      titulo: v.titulo ?? "",
      transcricao: v.transcricao ?? "",
      nomeNicho: v.nomeNicho,
      termosNicho: v.termosNicho,
    }),
  }));

  const loteIdExterno = await criarLote(itens);

  await db()
    .insert(lotesIa)
    .values({
      tarefa: "extrairVideo",
      loteIdExterno,
      videoIds: prontos.map((v) => v.id),
      status: "em_andamento",
    });

  return { videosNoLote: prontos.length, transcricaoCurtaDemais: curtos.length, loteIdExterno, imediato };
}
