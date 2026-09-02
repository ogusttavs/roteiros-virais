/**
 * Normalizador do YouTube (etapa 6): funcao pura, entrada bruta da API,
 * saida `{ video, conta }` no formato que o banco espera. Sem chamada de
 * rede nem de banco aqui, para testar so com fixtures.
 */
import type { YoutubeVideoItem } from "@/jobs/youtube-api";

export type ContaNormalizada = {
  plataforma: "youtube";
  handle: string;
  nome: string | null;
  url: string | null;
};

export type VideoNormalizado = {
  plataforma: "youtube";
  idExterno: string;
  url: string;
  titulo: string | null;
  descricao: string | null;
  publicadoEm: Date | null;
  duracaoS: number | null;
  views: number;
  likes: number;
  comentarios: number;
};

export type VideoEContaNormalizados = { video: VideoNormalizado; conta: ContaNormalizada };

/** "PT1M30S" -> 90; "PT45S" -> 45. Nulo se o formato nao bater. */
export function parseDuracaoIso8601(duracao: string): number | null {
  const encontrado = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duracao);
  if (!encontrado) return null;
  const horas = Number(encontrado[1] ?? 0);
  const minutos = Number(encontrado[2] ?? 0);
  const segundos = Number(encontrado[3] ?? 0);
  return horas * 3600 + minutos * 60 + segundos;
}

export function normalizarVideoYoutube(item: YoutubeVideoItem): VideoEContaNormalizados {
  return {
    video: {
      plataforma: "youtube",
      idExterno: item.id,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      titulo: item.snippet.title || null,
      descricao: item.snippet.description || null,
      publicadoEm: item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : null,
      duracaoS: parseDuracaoIso8601(item.contentDetails.duration),
      views: Number(item.statistics.viewCount ?? 0),
      likes: Number(item.statistics.likeCount ?? 0),
      comentarios: Number(item.statistics.commentCount ?? 0),
    },
    conta: {
      plataforma: "youtube",
      handle: item.snippet.channelId,
      nome: item.snippet.channelTitle || null,
      url: `https://www.youtube.com/channel/${item.snippet.channelId}`,
    },
  };
}
