/**
 * Job `extrair` (etapa 8, diario, depois de `transcrever`): monta um lote
 * com a tarefa `extrairVideo` (modelo barato, pela API de lote) para todo
 * video com `transcricao` e sem `analise`. A API de lote e assincrona (ate
 * 24h); `extrairColeta` (job separado) e quem busca o resultado quando
 * pronto.
 */
import { and, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, videos } from "@/db/schema";
import { criarLote, type ItemLote } from "@/ia/lote";
import * as extrairVideo from "@/ia/prompts/extrairVideo";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Transcricao curta demais nao carrega informacao o bastante para o
 * extrator acertar (achado da revisao da etapa 8): esses videos nao entram
 * no lote e ganham uma proxima tentativa de transcricao, para o job
 * `transcrever` tentar de novo pelo audio se a legenda foi o problema.
 */
const TAMANHO_MINIMO_TRANSCRICAO = 80;

export async function rodarExtrair(): Promise<Record<string, unknown>> {
  const candidatos = await db()
    .select({ id: videos.id, titulo: videos.titulo, transcricao: videos.transcricao })
    .from(videos)
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
    return { videosNoLote: 0, transcricaoCurtaDemais: curtos.length };
  }

  const itens: ItemLote<extrairVideo.SaidaExtrairVideo>[] = prontos.map((v) => ({
    customId: String(v.id),
    tarefa: "extrairVideo",
    nivel: extrairVideo.nivel,
    schema: extrairVideo.schema,
    sistemaEstavel: extrairVideo.montarSistemaEstavel(),
    entrada: extrairVideo.montarEntrada({ titulo: v.titulo ?? "", transcricao: v.transcricao ?? "" }),
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

  return { videosNoLote: prontos.length, transcricaoCurtaDemais: curtos.length, loteIdExterno };
}
