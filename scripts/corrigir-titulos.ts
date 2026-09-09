/**
 * Corrige o titulo vazio dos videos do TikTok e do Instagram ja coletados
 * antes de o normalizador gravar um titulo de verdade (`PROXIMO.md`, E6
 * parte 3, item 3): mesma `tituloDeVideo` que o normalizador usa em video
 * novo, aplicada aos que ja estao no banco. Idempotente: so toca video com
 * `titulo` nulo, rodar de novo nao muda nada (o `set` de `upsertVideo` numa
 * recoleta tambem nunca mexe em `titulo`, entao sem este script um video
 * antigo ficava sem titulo para sempre).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { contas, videos } from "@/db/schema";
import { tituloDeVideo } from "@/servicos/normalizadores/titulo";

export async function corrigirTitulos(): Promise<{ videosSemTitulo: number; videosCorrigidos: number }> {
  const semTitulo = await db()
    .select({
      id: videos.id,
      descricao: videos.descricao,
      publicadoEm: videos.publicadoEm,
      handle: contas.handle,
    })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(inArray(videos.plataforma, ["tiktok", "instagram"]), isNull(videos.titulo)));

  let videosCorrigidos = 0;
  for (const video of semTitulo) {
    const titulo = tituloDeVideo(video.descricao, video.handle ?? "conta", video.publicadoEm);
    await db().update(videos).set({ titulo, atualizadoEm: new Date() }).where(eq(videos.id, video.id));
    videosCorrigidos += 1;
  }

  return { videosSemTitulo: semTitulo.length, videosCorrigidos };
}

if (require.main === module) {
  corrigirTitulos()
    .then((resultado) => {
      console.log(JSON.stringify(resultado, null, 2));
      process.exit(0);
    })
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}
