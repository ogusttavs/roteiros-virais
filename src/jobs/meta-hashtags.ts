/**
 * Job `meta-hashtags` (E6 parte 3, segunda rodada, item 3): semanal
 * (segunda de manhã), por nicho, resolve até `TERMOS_POR_NICHO` termos com
 * `ig_hashtag_search` e lê `top_media` de cada um. A Hashtag Search e
 * global (achado de 08/09/2026: o primeiro resultado de "limpeza" era de
 * Portugal), entao um item so vira video se a legenda passar no filtro de
 * Brasil (`temIndicioDeBrasil`). Sem conta dona (`videos.contaId = null`,
 * `videos.semDono = true`): nunca recebe mediana nem multiplo, so serve de
 * sinal de assunto (transcricao e extracao), como qualquer outro video.
 *
 * O limite de 30 hashtags unicas por semana e da propria Meta, na
 * resolucao (`ig_hashtag_search`), nao no `top_media`: `hashtags_meta_usadas`
 * guarda o `hashtagId` de cada termo ja resolvido, para dois nichos com o
 * mesmo termo (ou o mesmo nicho numa semana seguinte, dentro dos 7 dias)
 * nunca gastarem duas vezes a mesma vaga.
 *
 * `media_url` da Meta expira (nao documentado por quanto tempo): baixa e
 * transcreve o audio na hora, em vez de deixar para o job `transcrever`
 * de hoje a noite, que de qualquer forma nunca selecionaria estes videos
 * (a selecao dele exige `foraDaCurva`/`velocidadeRelativa`, que um video
 * sem conta nunca tem, `pontuar.ts` nunca calcula para ele).
 */
import { and, eq, gte } from "drizzle-orm";

import { temIndicioDeBrasil } from "@/config/brasil";
import { db } from "@/db";
import { hashtagsMetaUsadas, nichos, videos } from "@/db/schema";
import { buscarIdDaHashtag, buscarTopMediaDaHashtag } from "@/jobs/meta-api";
import { config } from "@/lib/config";
import { normalizarHashtagMedia } from "@/servicos/normalizadores/meta";

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
  let transcritos = 0;
  const foraDoLimite: string[] = [];
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
          const idEncontrado = await buscarIdDaHashtag(termo);
          if (!idEncontrado) {
            erros.push(`hashtag "${termo}": nao encontrada na meta`);
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
        const itens = await buscarTopMediaDaHashtag(hashtagId);
        for (const item of itens) {
          if (!temIndicioDeBrasil(item.caption ?? "", nicho.termos)) continue;

          const video = normalizarHashtagMedia(item, termo);
          const resultado = await upsertVideo(video, null, nicho.id, null, "meta");
          if (resultado === "novo") videosNovos += 1;
          else videosAtualizados += 1;

          if (resultado === "novo") {
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
    transcritos,
    hashtagsUsadasNaSemana: usadosNaSemana,
    hashtagsForaDoLimite: foraDoLimite.length > 0 ? foraDoLimite : undefined,
    erros: erros.length > 0 ? erros : undefined,
  };
}
