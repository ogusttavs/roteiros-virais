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

/**
 * `items` vem ausente (nao um array vazio) quando a busca nao acha nada,
 * confirmado rodando contra a API de verdade nesta etapa.
 */
export type YoutubeSearchResponse = {
  items?: YoutubeSearchItem[];
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

export type YoutubeSearchChannelItem = {
  id: { channelId?: string };
  snippet: { channelTitle: string };
};

export type YoutubeSearchChannelResponse = { items?: YoutubeSearchChannelItem[] };

/**
 * `type=channel` (M2, item 1a): nenhuma busca existente no motor usa este tipo (só `type=video`,
 * `buscarPorTermo` acima); o job `pesquisa-de-setor` é o primeiro a precisar de "quais canais mais
 * aparecem para este termo", não "quais vídeos". Sem `videoDuration`/`order=viewCount` (não fazem
 * sentido para canal); `relevanceLanguage`/`regionCode` continuam, mesmo raciocínio de `buscarPorTermo`.
 */
export async function buscarCanaisPorTermo(termo: string): Promise<YoutubeSearchChannelResponse> {
  return chamar<YoutubeSearchChannelResponse>("search", {
    part: "snippet",
    q: termo,
    type: "channel",
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
    /**
     * Idioma do audio/dos metadados do video, formato BCP-47 (ex.: "pt-BR",
     * "en-US"), quando o canal preencheu (V2b, item 2: o Brasil primeiro).
     * Ja vem de graca dentro de `snippet`, sem custo de cota a mais.
     */
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
  };
  contentDetails: { duration: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
};

export type YoutubeVideosResponse = { items?: YoutubeVideoItem[] };

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
  /**
   * `country`, formato ISO 3166-1 alpha-2 (ex.: "BR"), quando o canal
   * preencheu (V2b, item 2: o Brasil primeiro). Ja vem de graca dentro de
   * `snippet`, sem custo de cota a mais.
   */
  snippet: { title: string; customUrl?: string; country?: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
  /** So vem quando `part` inclui "statistics" (`buscarCanaisPorId`, E6 parte 3, item 4). */
  statistics?: { subscriberCount?: string };
};

export type YoutubeChannelsResponse = { items?: YoutubeChannelItem[] };

/** channels.list: resolve o canal (por id ou @handle) para a playlist de uploads dele. */
export async function buscarCanal(idOuHandle: string): Promise<YoutubeChannelsResponse> {
  const chave = idOuHandle.startsWith("@") ? "forHandle" : "id";
  return chamar<YoutubeChannelsResponse>("channels", {
    part: "snippet,contentDetails",
    [chave]: idOuHandle,
  });
}

/**
 * channels.list em lote (ate 50 ids por chamada, 1 unidade no total): usado
 * por `scripts/preencher-nome-contas.ts` (nome do canal) e por
 * `coleta-youtube.ts` (`statistics.subscriberCount`, E6 parte 3, item 4,
 * uma chamada por 50 canais distintos de cada lote de `videos.list`).
 * `buscarCanal` (acima) resolve um so, por id ou @handle, para a coleta
 * descobrir a playlist de uploads de uma conta vigiada.
 */
export async function buscarCanaisPorId(ids: string[]): Promise<YoutubeChannelsResponse> {
  if (ids.length === 0) return { items: [] };
  return chamar<YoutubeChannelsResponse>("channels", {
    part: "snippet,statistics",
    id: ids.slice(0, 50).join(","),
  });
}

export type YoutubePlaylistItem = {
  snippet: {
    resourceId: { videoId: string };
    publishedAt: string;
  };
};

export type YoutubePlaylistItemsResponse = { items?: YoutubePlaylistItem[] };

/** playlistItems.list: os videos mais recentes da playlist de uploads de um canal. */
export async function buscarUploadsDoCanal(playlistId: string): Promise<YoutubePlaylistItemsResponse> {
  return chamar<YoutubePlaylistItemsResponse>("playlistItems", {
    part: "snippet",
    playlistId,
    maxResults: "50",
  });
}

export type YoutubeVideoPopular = {
  id: string;
  snippet: { title: string; channelTitle: string; channelId?: string; categoryId?: string; publishedAt?: string };
  statistics?: { viewCount?: string };
};

export type YoutubePopularesResponse = { items?: YoutubeVideoPopular[] };

/**
 * videos.list com `chart=mostPopular` e `regionCode=BR` (E55): os vídeos em alta no YouTube no Brasil, de todas as categorias. Custa 1 unidade de cota (como todo `videos.list`). `categoryId` vem
 * junto, para o job tirar música e jogo (que não servem de assunto para um dono de negócio).
 */
export async function buscarMaisPopularesNoBrasil(): Promise<YoutubePopularesResponse> {
  return chamar<YoutubePopularesResponse>("videos", {
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode: "BR",
    maxResults: "50",
  });
}

/**
 * `commentThreads.list` (E28): o que está escrito no tipo é só o que o produto lê (o id, o texto, as curtidas e a data do
 * comentário de cima de cada conversa). A API devolve também o nome, a foto e o endereço de quem escreveu; nada disso é lido nem
 * tipado aqui, e o normalizador (`servicos/normalizadores/comentarios-youtube.ts`) monta o objeto campo a campo, nunca por espalhamento.
 */
export type YoutubeCommentThread = {
  id: string;
  snippet: {
    topLevelComment?: {
      id?: string;
      snippet?: { textDisplay?: string; textOriginal?: string; likeCount?: number; publishedAt?: string };
    };
  };
};

export type YoutubeCommentThreadsResponse = { items?: YoutubeCommentThread[] };

/**
 * Os comentários de cima de um vídeo, pela relevância que o YouTube dá (a primeira página, até 100): 1 unidade da cota. Vídeo com os
 * comentários desligados responde 403 com `commentsDisabled`; veja `motivoDaFalhaDosComentarios`.
 */
export async function buscarComentariosDoVideo(videoId: string, maximo = 100): Promise<YoutubeCommentThreadsResponse> {
  return chamar<YoutubeCommentThreadsResponse>("commentThreads", {
    part: "snippet",
    videoId,
    order: "relevance",
    maxResults: String(Math.max(1, Math.min(100, maximo))),
    textFormat: "plainText",
  });
}

/**
 * Por que a leitura dos comentários de um vídeo falhou (E28): "desligados" (o canal desligou, ou o vídeo saiu do ar: não adianta
 * tentar de novo), "cota" (a cota do DIA acabou: para o job inteiro) ou "outro" (rede, 5xx, limite por segundo, vídeo ainda
 * processando: tem uma segunda tentativa na rodada, e o vídeo não é marcado).
 */
export function motivoDaFalhaDosComentarios(erro: unknown): "desligados" | "cota" | "outro" {
  if (!(erro instanceof ErroYoutubeApi)) return "outro";
  if (/quotaExceeded|dailyLimitExceeded/.test(erro.message)) return "cota";
  if (erro.status === 403 && /commentsDisabled/.test(erro.message)) return "desligados";
  if (erro.status === 404 || /videoNotFound/.test(erro.message)) return "desligados";
  return "outro";
}
