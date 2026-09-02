/**
 * Cliente fino do YouTube Data API v3 (etapa 6): so fetch contra o REST, sem
 * a biblioteca `googleapis` (pesada, e o projeto so precisa de tres
 * endpoints). Cada funcao devolve o JSON tipado e o custo em unidades da
 * chamada, para quem chama registrar a cota.
 *
 * search.list custa 100 unidades; videos.list, playlistItems.list e
 * channels.list custam 1 (estrategia/escopo-e-arquitetura.md, secao 5.7,
 * mais a documentacao oficial da API).
 */
import { config } from "@/lib/config";

const BASE = "https://www.googleapis.com/youtube/v3";

export class ErroYoutubeApi extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function chamar<T>(caminho: string, parametros: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}/${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) {
    url.searchParams.set(chave, valor);
  }
  url.searchParams.set("key", config.coleta.youtubeKey);

  const resposta = await fetch(url);
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new ErroYoutubeApi(`YouTube API respondeu ${resposta.status}: ${corpo.slice(0, 500)}`, resposta.status);
  }
  return (await resposta.json()) as T;
}

export type YoutubeSearchItem = {
  id: { videoId?: string };
  snippet: {
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    publishedAt: string;
  };
};

export type YoutubeSearchResponse = {
  items: YoutubeSearchItem[];
  nextPageToken?: string;
};

/** search.list: 100 unidades por chamada. */
export const CUSTO_SEARCH = 100;
/** videos.list, playlistItems.list, channels.list: 1 unidade por chamada. */
export const CUSTO_LISTA = 1;

/**
 * Busca por termo, ultimos 7 dias, so vertical curto (escopo 5.1: e a
 * camada rapida, "o que esta subindo", nao a base lenta inteira).
 */
export async function buscarPorTermo(
  termo: string,
  publicadoApos: Date,
): Promise<YoutubeSearchResponse> {
  return chamar<YoutubeSearchResponse>("search", {
    part: "snippet",
    q: termo,
    type: "video",
    videoDuration: "short",
    order: "viewCount",
    publishedAfter: publicadoApos.toISOString(),
    maxResults: "50",
    relevanceLanguage: "pt",
    regionCode: "BR",
  });
}

export type YoutubeVideoItem = {
  id: string;
  snippet: {
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    publishedAt: string;
  };
  contentDetails: { duration: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
};

export type YoutubeVideosResponse = { items: YoutubeVideoItem[] };

/** videos.list em lote (ate 50 ids por chamada, 1 unidade no total). */
export async function buscarVideosPorId(ids: string[]): Promise<YoutubeVideosResponse> {
  if (ids.length === 0) return { items: [] };
  return chamar<YoutubeVideosResponse>("videos", {
    part: "snippet,contentDetails,statistics",
    id: ids.slice(0, 50).join(","),
  });
}

export type YoutubeChannelItem = {
  id: string;
  snippet: { title: string; customUrl?: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
};

export type YoutubeChannelsResponse = { items: YoutubeChannelItem[] };

/** channels.list: resolve o canal (por id ou @handle) para a playlist de uploads dele. */
export async function buscarCanal(idOuHandle: string): Promise<YoutubeChannelsResponse> {
  const chave = idOuHandle.startsWith("@") ? "forHandle" : "id";
  return chamar<YoutubeChannelsResponse>("channels", {
    part: "snippet,contentDetails",
    [chave]: idOuHandle,
  });
}

export type YoutubePlaylistItem = {
  snippet: {
    resourceId: { videoId: string };
    publishedAt: string;
  };
};

export type YoutubePlaylistItemsResponse = { items: YoutubePlaylistItem[] };

/** playlistItems.list: os videos mais recentes da playlist de uploads de um canal. */
export async function buscarUploadsDoCanal(playlistId: string): Promise<YoutubePlaylistItemsResponse> {
  return chamar<YoutubePlaylistItemsResponse>("playlistItems", {
    part: "snippet",
    playlistId,
    maxResults: "50",
  });
}
