/**
 * Normalizador do Instagram (etapa 6, parte 2): funcao pura, entrada bruta
 * do ator do Apify, saida `{ video, conta, audio }` no mesmo formato do
 * YouTube, mais o audio (o Instagram expoe, o YouTube nao).
 */
import type { VideoAudio } from "@/db/schema";
import type { InstagramItemBruto } from "@/jobs/apify-api";

import { tituloDeVideo } from "./titulo";

export type ContaNormalizada = {
  plataforma: "instagram";
  handle: string;
  nome: string | null;
  url: string | null;
  seguidores: number | null;
};

export type VideoNormalizado = {
  plataforma: "instagram";
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

export type VideoContaEAudioNormalizados = {
  video: VideoNormalizado;
  conta: ContaNormalizada;
  audio: VideoAudio | null;
};

function normalizarAudio(item: InstagramItemBruto): VideoAudio | null {
  const musica = item.musicInfo;
  if (!musica || (!musica.audio_id && !musica.song_name)) return null;
  return {
    id: musica.audio_id,
    nome: musica.song_name,
    autor: musica.artist_name,
    original: musica.uses_original_audio,
  };
}

export function normalizarVideoInstagram(item: InstagramItemBruto): VideoContaEAudioNormalizados {
  const descricao = item.caption || null;
  const publicadoEm = item.timestamp ? new Date(item.timestamp) : null;

  return {
    video: {
      plataforma: "instagram",
      idExterno: item.shortCode || item.id,
      url: item.url,
      titulo: tituloDeVideo(descricao, item.ownerUsername, publicadoEm),
      descricao,
      publicadoEm,
      duracaoS: item.videoDuration ? Math.round(item.videoDuration) : null,
      views: item.videoPlayCount ?? item.videoViewCount ?? 0,
      likes: item.likesCount ?? 0,
      comentarios: item.commentsCount ?? 0,
    },
    conta: {
      plataforma: "instagram",
      handle: item.ownerUsername,
      nome: item.ownerFullName || item.ownerUsername || null,
      url: `https://www.instagram.com/${item.ownerUsername}`,
      seguidores: item.ownerFollowersCount ?? null,
    },
    audio: normalizarAudio(item),
  };
}
