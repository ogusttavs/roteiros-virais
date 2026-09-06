/**
 * Normalizador do TikTok (etapa 6, parte 2): funcao pura, entrada bruta do
 * ator do Apify, saida `{ video, conta, audio }` no mesmo formato do
 * YouTube, mais o audio (o TikTok expoe, o YouTube nao).
 */
import type { VideoAudio } from "@/db/schema";
import type { TiktokItemBruto } from "@/jobs/apify-api";

export type ContaNormalizada = {
  plataforma: "tiktok";
  handle: string;
  nome: string | null;
  url: string | null;
};

export type VideoNormalizado = {
  plataforma: "tiktok";
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

function normalizarAudio(item: TiktokItemBruto): VideoAudio | null {
  const musica = item.musicMeta;
  if (!musica || (!musica.musicId && !musica.musicName)) return null;
  return {
    id: musica.musicId,
    nome: musica.musicName,
    autor: musica.musicAuthor,
    original: musica.musicOriginal,
  };
}

/**
 * `null` quando o item veio sem o nome do autor (rodada de acabamento de
 * 06/09, item 3): achado real, "Cannot read properties of undefined" ao
 * tentar ler `authorMeta.name`, porque o item nem tinha `authorMeta`. Sem
 * handle nao da para gravar a conta (`contas.handle` e obrigatorio), entao
 * o item e pulado; quem chama registra um aviso no resumo em vez de
 * deixar o erro estourar e derrubar o lote inteiro.
 */
export function normalizarVideoTiktok(item: TiktokItemBruto): VideoContaEAudioNormalizados | null {
  const nomeAutor = item.authorMeta?.name;
  if (!nomeAutor) return null;

  return {
    video: {
      plataforma: "tiktok",
      idExterno: item.id,
      url: item.webVideoUrl,
      titulo: null,
      descricao: item.text || null,
      publicadoEm: item.createTimeISO ? new Date(item.createTimeISO) : null,
      duracaoS: item.videoMeta?.duration ?? null,
      views: item.playCount ?? 0,
      likes: item.diggCount ?? 0,
      comentarios: item.commentCount ?? 0,
    },
    conta: {
      plataforma: "tiktok",
      handle: nomeAutor,
      nome: item.authorMeta?.nickName || nomeAutor,
      url: `https://www.tiktok.com/@${nomeAutor}`,
    },
    audio: normalizarAudio(item),
  };
}
