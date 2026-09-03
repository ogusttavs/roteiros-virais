/**
 * Job `extrair` (etapa 8, diario, depois de `transcrever`): monta um lote
 * com a tarefa `extrairVideo` (modelo barato, pela API de lote) para todo
 * video com `transcricao` e sem `analise`. A API de lote e assincrona (ate
 * 24h); `extrairColeta` (job separado) e quem busca o resultado quando
 * pronto.
 */
import { and, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, videos } from "@/db/schema";
import { criarLote, type ItemLote } from "@/ia/lote";
import * as extrairVideo from "@/ia/prompts/extrairVideo";

export async function rodarExtrair(): Promise<Record<string, unknown>> {
  const candidatos = await db()
    .select({ id: videos.id, titulo: videos.titulo, transcricao: videos.transcricao })
    .from(videos)
    .where(and(isNotNull(videos.transcricao), isNull(videos.analise)));

  if (candidatos.length === 0) {
    return { videosNoLote: 0 };
  }

  const itens: ItemLote<extrairVideo.SaidaExtrairVideo>[] = candidatos.map((v) => ({
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
      videoIds: candidatos.map((v) => v.id),
      status: "em_andamento",
    });

  return { videosNoLote: candidatos.length, loteIdExterno };
}
