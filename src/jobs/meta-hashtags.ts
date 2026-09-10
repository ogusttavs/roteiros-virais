/**
 * Job `meta-hashtags` (E6 parte 3, segunda rodada, item 3, ajuste 2 da
 * revisao do PR #35): diario, as 04:20 (depois de `transcrever`, antes de
 * `extrair`), por nicho, resolve até `TERMOS_POR_NICHO` termos com
 * `ig_hashtag_search` e lê o `recent_media` de cada um. Era `top_media` e
 * semanal (segunda de manhã) na rodada anterior; a chamada real do Fable
 * contra a hashtag "limpeza" achou o motivo da troca: `top_media` devolveu
 * 50 itens, nenhum VIDEO, so IMAGE (48) e CAROUSEL_ALBUM (2), e o mesmo
 * termo pelo `recent_media` devolveu 38 VIDEO (todos REELS) em 50. Em troca,
 * `recent_media` e uma janela de 24h, entao o job precisa rodar todo dia
 * para nao perder o que saiu da janela; a trava de 30 hashtags por semana
 * continua so na resolucao (abaixo), entao rodar todo dia nao gasta mais
 * vaga nenhuma depois que o termo ja foi resolvido uma vez.
 *
 * So vira video um item com `media_type === "VIDEO"` ou
 * `media_product_type === "REELS"` (`ehVideo`, compartilhada com o
 * normalizador da Business Discovery); imagem e carrossel sao pulados e
 * contados em `itensNaoVideo`. A Hashtag Search e global (achado de
 * 08/09/2026: o primeiro resultado de "limpeza" era de Portugal), entao um
 * item so vira video de verdade se a legenda tambem passar no filtro de
 * Brasil (`temIndicioDeBrasil`). Sem conta dona (`videos.contaId = null`,
 * `videos.semDono = true`): nunca recebe mediana nem multiplo, so serve de
 * sinal de assunto (transcricao e extracao), como qualquer outro video.
 *
 * O limite de 30 hashtags unicas por semana e da propria Meta, na
 * resolucao (`ig_hashtag_search`), nao no `recent_media`: `hashtags_meta_usadas`
 * guarda o `hashtagId` de cada termo ja resolvido, para dois nichos com o
 * mesmo termo (ou o mesmo nicho num dia seguinte, dentro dos 7 dias) nunca
 * gastarem duas vezes a mesma vaga.
 *
 * `media_url` da Meta expira (nao documentado por quanto tempo) e nem todo
 * item do `recent_media` traz um (achado real: 21 dos 38 VIDEO); baixa e
 * transcreve o audio na hora, em vez de deixar para o job `transcrever` de
 * hoje a noite (que de qualquer forma nunca selecionaria estes videos, a
 * selecao dele exige `foraDaCurva`/`velocidadeRelativa`, que um video sem
 * conta nunca tem). Sem `media_url` nao e erro: o video entra so com a
 * legenda como sinal, sem transcricao, contado em `semMediaUrl`.
 *
 * Achado do dia 1 da conferencia de producao (10/09/2026): os termos do
 * nicho tem espaco ("limpeza a seco"), e `ig_hashtag_search` respondia
 * "The requested resource does not exist" para a maioria; `normalizarHashtag`
 * (compartilhada com `apify-api.ts`) tira espaco, acento e o que mais nao e
 * letra, numero ou underscore antes de resolver. `hashtags_meta_usadas.termo`
 * continua com o termo original do nicho. Hashtag que nao existe de verdade
 * (a Meta devolve vazio, nao erro) e contada em `hashtagsInexistentes`, fora
 * de `erros`: e um termo sem hashtag, nao uma falha do job.
 */
import { and, eq, gte } from "drizzle-orm";

import { temIndicioDeBrasil } from "@/config/brasil";
import { db } from "@/db";
import { hashtagsMetaUsadas, nichos, videos } from "@/db/schema";
import { buscarIdDaHashtag, buscarRecentMediaDaHashtag } from "@/jobs/meta-api";
import { config } from "@/lib/config";
import { normalizarHashtag } from "@/servicos/normalizadores/hashtag";
import { ehVideo, normalizarHashtagMedia } from "@/servicos/normalizadores/meta";

import { apagarAudio, baixarAudio, ErroAudio } from "./audio";
import { upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";
import { ErroGroq, transcreverAudio } from "./groq-api";

const TERMOS_POR_NICHO = 8;
/** 30 por semana, o limite real da Meta na resolucao. Exportado para o admin mostrar "hashtags usadas na semana" (PROXIMO.md, item 5). */
export const LIMITE_HASHTAGS_SEMANA = 30;
export const JANELA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

async function transcreverVideoNovo(idExterno: string, mediaUrl: string | undefined): Promise<boolean> {
  if (!config.transcricao.groqKey || !mediaUrl) return false;

  let caminhoAudio: string | null = null;
  try {
    caminhoAudio = await baixarAudio(mediaUrl);
    const texto = await transcreverAudio(caminhoAudio);
    await db()
      .update(videos)
      .set({ transcricao: texto })
      .where(and(eq(videos.plataforma, "instagram"), eq(videos.idExterno, idExterno)));
    return true;
  } finally {
    if (caminhoAudio) await apagarAudio(caminhoAudio);
  }
}

export async function rodarMetaHashtags(nichoId?: number): Promise<Record<string, unknown>> {
  if (!config.coleta.metaAtivo) {
    throw new ErroColeta("META_ATIVO nao esta ligado; a hashtag search da meta fica desligada", false);
  }

  const seteDiasAtras = new Date(Date.now() - JANELA_SEMANA_MS);
  const usadosRecentes = await db()
    .select()
    .from(hashtagsMetaUsadas)
    .where(gte(hashtagsMetaUsadas.ultimoUsoEm, seteDiasAtras));
  const mapaResolvidos = new Map(usadosRecentes.map((u) => [u.termo, u.hashtagId]));
  let usadosNaSemana = usadosRecentes.length;

  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select().from(nichos).where(condicao);

  let videosNovos = 0;
  let videosAtualizados = 0;
  let itensNaoVideo = 0;
  let semMediaUrl = 0;
  let transcritos = 0;
  const foraDoLimite: string[] = [];
  /**
   * Termo sem hashtag na Meta (achado do dia 1 da conferência, 10/09/2026):
   * não é falha do job, é um termo do nicho que não vira hashtag de
   * verdade lá. Contado à parte de `erros`, para a conferência distinguir
   * "termo sem hashtag" de "a Meta falhou".
   */
  const hashtagsInexistentes: string[] = [];
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    for (const termo of nicho.termos.slice(0, TERMOS_POR_NICHO)) {
      let hashtagId = mapaResolvidos.get(termo);

      if (!hashtagId) {
        if (usadosNaSemana >= LIMITE_HASHTAGS_SEMANA) {
          foraDoLimite.push(termo);
          continue;
        }
        try {
          const idEncontrado = await buscarIdDaHashtag(normalizarHashtag(termo));
          if (!idEncontrado) {
            hashtagsInexistentes.push(termo);
            continue;
          }
          hashtagId = idEncontrado;
          await db()
            .insert(hashtagsMetaUsadas)
            .values({ termo, hashtagId })
            .onConflictDoUpdate({
              target: hashtagsMetaUsadas.termo,
              set: { hashtagId, ultimoUsoEm: new Date() },
            });
          mapaResolvidos.set(termo, hashtagId);
          usadosNaSemana += 1;
        } catch (erro) {
          erros.push(`hashtag "${termo}": ${erro instanceof Error ? erro.message : String(erro)}`);
          continue;
        }
      }

      try {
        const itens = await buscarRecentMediaDaHashtag(hashtagId);
        for (const item of itens) {
          if (!ehVideo(item)) {
            itensNaoVideo += 1;
            continue;
          }
          if (!temIndicioDeBrasil(item.caption ?? "", nicho.termos)) continue;

          const video = normalizarHashtagMedia(item, termo);
          const resultado = await upsertVideo(video, null, nicho.id, null, "meta");
          if (resultado !== "novo") {
            videosAtualizados += 1;
            continue;
          }
          videosNovos += 1;
          if (!item.media_url) {
            semMediaUrl += 1;
            continue;
          }
          try {
            if (await transcreverVideoNovo(video.idExterno, item.media_url)) transcritos += 1;
          } catch (erroTranscricao) {
            if (!(erroTranscricao instanceof ErroAudio) && !(erroTranscricao instanceof ErroGroq)) {
              throw erroTranscricao;
            }
            erros.push(
              `hashtag "${termo}" / video "${video.idExterno}": ${erroTranscricao.message}`,
            );
          }
        }
      } catch (erro) {
        erros.push(`hashtag "${termo}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  return {
    nichos: nichosAtivos.length,
    videosNovos,
    videosAtualizados,
    itensNaoVideo,
    semMediaUrl,
    transcritos,
    hashtagsUsadasNaSemana: usadosNaSemana,
    hashtagsForaDoLimite: foraDoLimite.length > 0 ? foraDoLimite : undefined,
    hashtagsInexistentes: hashtagsInexistentes.length > 0 ? hashtagsInexistentes : undefined,
    erros: erros.length > 0 ? erros : undefined,
  };
}
