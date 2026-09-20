/**
 * Preenche `videos.idioma` de todo vídeo já coletado antes da detecção por
 * código existir (V2b, item 5, escopo 5.11: o Brasil primeiro), em lotes,
 * e depois roda o item 4 (`idioma_principal` e `pais` por conta), para o
 * backfill sair completo numa passada só. Idempotente: só toca vídeo com
 * `idioma` nulo, então rodar de novo depois de já ter rodado não faz nada
 * de novo (a não ser que a coleta tenha trazido vídeo novo desde então).
 *
 * `npm run preencher:idioma`, uma vez no `roteiros_dev` (o resultado colado
 * no PR desta etapa); em produção quem roda é o Fable, depois do deploy.
 */
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db";
import { videos, type Plataforma } from "@/db/schema";

import { detectarIdioma } from "../src/config/idioma";
import { passo6IdiomaPrincipalPorConta, passo7PaisPorIdiomaPrincipal } from "../src/jobs/pontuar";

const TAMANHO_LOTE = 500;

/**
 * Paginado por cursor de id crescente, não por "ainda tem idioma nulo"
 * (achado ao escrever isto): um vídeo sem nenhum sinal de idioma continua
 * nulo depois de processado (`detectarIdioma` nunca chuta), então um laço
 * que buscasse sempre "os primeiros com idioma nulo" nunca avançaria dele,
 * travando para sempre. Avançar por id garante progresso mesmo quando a
 * detecção não acha nada.
 */
async function preencherPorTitulo(): Promise<number> {
  let totalAtualizados = 0;
  let ultimoId = 0;

  for (;;) {
    const lote = await db()
      .select({ id: videos.id, titulo: videos.titulo, descricao: videos.descricao })
      .from(videos)
      .where(and(isNull(videos.idioma), gt(videos.id, ultimoId)))
      .orderBy(asc(videos.id))
      .limit(TAMANHO_LOTE);

    if (lote.length === 0) break;

    for (const video of lote) {
      const idioma = detectarIdioma(`${video.titulo ?? ""} ${video.descricao ?? ""}`);
      if (idioma) {
        await db().update(videos).set({ idioma }).where(eq(videos.id, video.id));
        totalAtualizados += 1;
      }
    }
    ultimoId = lote[lote.length - 1].id;

    if (lote.length < TAMANHO_LOTE) break;
  }

  return totalAtualizados;
}

type ContagemPorIdioma = Record<string, number>;
type ContagemPorPlataforma = Record<Plataforma, ContagemPorIdioma>;

async function contarPorIdiomaEPlataforma(): Promise<ContagemPorPlataforma> {
  const linhas = await db()
    .select({ plataforma: videos.plataforma, idioma: videos.idioma, total: count() })
    .from(videos)
    .groupBy(videos.plataforma, videos.idioma);

  const resultado: ContagemPorPlataforma = { youtube: {}, tiktok: {}, instagram: {} };
  for (const linha of linhas) {
    const chave = linha.idioma ?? "sem_idioma";
    resultado[linha.plataforma][chave] = linha.total;
  }
  return resultado;
}

export async function preencherIdioma(): Promise<{
  videosSemIdiomaAntes: number;
  videosAtualizadosPorTitulo: number;
  contasComIdiomaPrincipal: number;
  contasComPaisPorIdioma: number;
  contagemPorPlataforma: ContagemPorPlataforma;
}> {
  const [{ semIdioma }] = await db()
    .select({ semIdioma: count() })
    .from(videos)
    .where(and(isNull(videos.idioma)));

  const videosAtualizadosPorTitulo = await preencherPorTitulo();
  const r6 = await passo6IdiomaPrincipalPorConta();
  const r7 = await passo7PaisPorIdiomaPrincipal();
  const contagemPorPlataforma = await contarPorIdiomaEPlataforma();

  return {
    videosSemIdiomaAntes: semIdioma,
    videosAtualizadosPorTitulo,
    contasComIdiomaPrincipal: r6.rowCount ?? 0,
    contasComPaisPorIdioma: r7,
    contagemPorPlataforma,
  };
}

if (require.main === module) {
  preencherIdioma()
    .then((resultado) => {
      console.log(JSON.stringify(resultado, null, 2));
      process.exit(0);
    })
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}
