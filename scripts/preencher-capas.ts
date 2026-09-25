/**
 * Preenche `videos.capaUrl` do que já foi coletado antes da coluna existir
 * (V9d, item 0b, sub-item 4): só o YouTube, porque a miniatura sai por
 * código a partir do `idExterno`, sem chamada nenhuma
 * (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`, mesma fórmula do
 * normalizador em `servicos/normalizadores/youtube.ts`).
 *
 * Instagram (Business Discovery) e TikTok (Apify, ainda suspenso) ficam de
 * fora deste backfill (decisão registrada em `TODO.md`, "Decisões
 * pendentes"): a miniatura das duas só vem de uma chamada nova à
 * plataforma, por vídeo, o que este script não faz; os vídeos existentes
 * ficam sem capa até a próxima recoleta natural preencher sozinha.
 *
 * Idempotente: só toca vídeo do YouTube com `capaUrl` nulo.
 *
 * `npm run preencher:capas`, uma vez no `roteiros_dev` (o resultado colado
 * no PR desta etapa); em produção quem roda é o Fable, depois do deploy.
 */
import { and, asc, eq, gt, isNull, count } from "drizzle-orm";

import { db } from "@/db";
import { videos } from "@/db/schema";

const TAMANHO_LOTE = 500;

function capaUrlDoYoutube(idExterno: string): string {
  return `https://i.ytimg.com/vi/${idExterno}/hqdefault.jpg`;
}

async function preencherCapasDoYoutube(): Promise<number> {
  let totalAtualizados = 0;
  let ultimoId = 0;

  for (;;) {
    const lote = await db()
      .select({ id: videos.id, idExterno: videos.idExterno })
      .from(videos)
      .where(and(eq(videos.plataforma, "youtube"), isNull(videos.capaUrl), gt(videos.id, ultimoId)))
      .orderBy(asc(videos.id))
      .limit(TAMANHO_LOTE);

    if (lote.length === 0) break;

    for (const video of lote) {
      await db()
        .update(videos)
        .set({ capaUrl: capaUrlDoYoutube(video.idExterno) })
        .where(eq(videos.id, video.id));
      totalAtualizados += 1;
    }
    ultimoId = lote[lote.length - 1].id;

    if (lote.length < TAMANHO_LOTE) break;
  }

  return totalAtualizados;
}

export async function preencherCapas(): Promise<{
  videosSemCapaAntes: number;
  videosDoYoutubeAtualizados: number;
}> {
  const [{ semCapa }] = await db()
    .select({ semCapa: count() })
    .from(videos)
    .where(isNull(videos.capaUrl));

  const videosDoYoutubeAtualizados = await preencherCapasDoYoutube();

  return {
    videosSemCapaAntes: semCapa,
    videosDoYoutubeAtualizados,
  };
}

if (require.main === module) {
  preencherCapas()
    .then((resultado) => {
      console.log(JSON.stringify(resultado, null, 2));
      process.exit(0);
    })
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}
