/**
 * Cliente fino do Apify (etapa 6, parte 2): chama um ator e devolve os itens
 * do dataset padrao da execucao. `maxItems` limita quanto e cobrado (os dois
 * atores usados aqui sao pay-per-result/pay-per-event).
 *
 * Atores confirmados na loja da Apify em 02/09/2026 (HISTORICO.md):
 * `clockworks/tiktok-scraper` (US$1,70/mil resultados) e
 * `apify/instagram-scraper` (US$2,70/mil no plano gratuito). Nome do ator
 * nunca fixo no codigo (CLAUDE.md, decisao do Fable): vem de
 * `config.coleta.atorTiktok` / `atorInstagram`.
 */
import { ApifyClient } from "apify-client";

import { config } from "@/lib/config";
import { normalizarHashtag } from "@/servicos/normalizadores/hashtag";

let instancia: ApifyClient | null = null;

function cliente(): ApifyClient {
  if (!instancia) {
    instancia = new ApifyClient({ token: config.coleta.apifyToken });
  }
  return instancia;
}

export class ErroApify extends Error {}

/**
 * Roda um ator ate terminar e devolve os itens do dataset padrao da
 * execucao, cortados em `maxItems`, junto com `devolvidos`, quantos o
 * dataset trouxe antes do corte. O `maxItems` da chamada ao ator so limita
 * quanto e cobrado, nao quanto o ator devolve no dataset (achado rodando
 * com chave real: pediu 20, o dataset trouxe mais); cortar aqui e o que faz
 * o teto diario em `consumo_api` bater com o que de fato processamos.
 * `devolvidos` e o que de fato foi cobrado (PROXIMO.md, item 1: a rodada de
 * 07/09 pagou 1.602 resultados e consumiu 400, porque `resultsPerPage`
 * multiplicava por alvo em vez de dividir o teto entre eles).
 */
export async function rodarAtor<T>(
  ator: string,
  input: Record<string, unknown>,
  maxItems: number,
): Promise<{ itens: T[]; devolvidos: number }> {
  const execucao = await cliente().actor(ator).call(input, { maxItems });
  const { items } = await cliente().dataset(execucao.defaultDatasetId).listItems();
  return { itens: (items as T[]).slice(0, maxItems), devolvidos: items.length };
}

/**
 * `resultsPerPage`/`resultsLimit` valem por alvo (hashtag ou perfil), nao no
 * total (achado de 07/09, PROXIMO.md item 1): pedir o teto inteiro por alvo
 * multiplica o que e cobrado pelo numero de alvos. O limite por chamada
 * passa a ser o teto dividido pelo numero de alvos, arredondado para cima
 * (sobra de arredondamento e melhor que faltar resultado).
 */
export function limitePorAlvo(teto: number, numeroDeAlvos: number): number {
  if (numeroDeAlvos <= 0) return teto;
  return Math.ceil(teto / numeroDeAlvos);
}

/**
 * Item bruto do TikTok (clockworks/tiktok-scraper), so os campos que a
 * normalizacao usa. `authorMeta` e `authorMeta.name` marcados opcionais
 * (rodada de acabamento de 06/09, item 3): a documentacao do ator promete
 * os dois sempre presentes, mas um item real veio sem `authorMeta`
 * nenhum ("Cannot read properties of undefined"). `id` continua obrigatorio
 * na tipagem (e o que a doc promete de mais estavel), mas o normalizador
 * trata mesmo esse como podendo faltar, pelo mesmo motivo.
 */
export type TiktokItemBruto = {
  id: string;
  text?: string;
  webVideoUrl: string;
  createTimeISO?: string;
  /** `fans` (E6 parte 3, item 4): contagem de seguidores do autor, quando o ator devolve. */
  authorMeta?: { name?: string; nickName?: string; fans?: number };
  videoMeta?: { duration?: number };
  musicMeta?: { musicId?: string; musicName?: string; musicAuthor?: string; musicOriginal?: boolean };
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
};

/**
 * Resultados por termo na busca por hashtag (E6 parte 3, terceira rodada,
 * item 1): fixo, nao dividido pelo teto como `limitePorAlvo` fazia antes.
 * Os 30 mais populares da semana de um termo sao, na pratica, os fora da
 * curva dele; pedir mais que isso e pagar por vídeo que não ajuda a achar
 * conta nova.
 */
export const RESULTADOS_POR_TERMO_HASHTAG = 30;

/**
 * Videos por perfil vigiado na vigilancia diaria (E6 parte 3, terceira
 * rodada, item 3): so os mais recentes, fixo por perfil, nao dividido pelo
 * teto.
 */
export const VIDEOS_POR_PERFIL_VIGILANCIA = 5;

/**
 * Busca por hashtag (PROXIMO.md, decisao 2: os termos do nicho viram
 * hashtag), so a semana e so os termos do rodizio do dia (E6 parte 3,
 * terceira rodada, itens 1 e 2, `termosDaRodada` em `coleta-apify.ts`).
 *
 * `oldestPostDateUnified` aceita data relativa ("7 days", confirmado no
 * schema de entrada do ator em 09/09/2026, via `api.apify.com/v2/acts/
 * clockworks~tiktok-scraper/builds/<ultimo>`) e nao e descrito como
 * exclusivo de perfil, apesar de a UI do ator agrupar o campo visualmente
 * com as opcoes de perfil. `videoSearchSorting`/`videoSearchDateFilter`
 * (que teriam `MOST_LIKED`/`PAST_WEEK`) ficaram de fora de proposito: a
 * documentacao do ator e explicita que os dois "so valem com a secao
 * /video" da busca por termo (`searchQueries` + `searchSection`), que nao e
 * o que este projeto usa (aqui os termos do nicho viram hashtag, decisao
 * 2); nao ha um parametro de ordenacao documentado para `hashtags`, so o
 * filtro de data. Sem prova com chave real (item 7 desta rodada depende do
 * limite mensal do Apify), fica em `TODO.md` como decisao pendente: se a
 * pagina de hashtag do TikTok ja devolve em ordem de popularidade por
 * padrao (e o que o produto conta com), ou se um dia sera preciso pedir
 * mais que 30 e ordenar no codigo por `diggCount`/`playCount` antes de
 * cortar.
 */
export async function buscarTiktokPorHashtag(
  termos: string[],
  maxItems: number,
): Promise<{ itens: TiktokItemBruto[]; devolvidos: number }> {
  if (termos.length === 0) return { itens: [], devolvidos: 0 };
  const input: Record<string, unknown> = {
    hashtags: termos.map(normalizarHashtag),
    resultsPerPage: RESULTADOS_POR_TERMO_HASHTAG,
    oldestPostDateUnified: "7 days",
  };
  return rodarAtor<TiktokItemBruto>(config.coleta.atorTiktok, input, maxItems);
}

/**
 * Vigilancia por perfil: `videosPorPerfil` mais recentes de cada conta.
 * `coleta-apify.ts` chama com `VIDEOS_POR_PERFIL_VIGILANCIA` (5, todo dia,
 * E6 parte 3, terceira rodada, item 3); `contas-base.ts` chama com
 * `VIDEOS_POR_CONTA` (10, so no catch-up de conta sem base, uma vez, mais
 * historico do que a vigilancia diaria precisa). `profileSorting: "latest"`
 * e o valor documentado no schema do ator para "mais recentes primeiro" (o
 * mesmo usado no `exampleRunInput` da documentacao publica do ator; era o
 * default implicito quando `buscarTiktok` nao mandava o campo, antes desta
 * rodada).
 */
export async function buscarTiktokVigilancia(
  perfis: string[],
  videosPorPerfil: number,
  maxItems: number,
): Promise<{ itens: TiktokItemBruto[]; devolvidos: number }> {
  if (perfis.length === 0) return { itens: [], devolvidos: 0 };
  const input: Record<string, unknown> = {
    profiles: perfis,
    resultsPerPage: videosPorPerfil,
    profileSorting: "latest",
  };
  return rodarAtor<TiktokItemBruto>(config.coleta.atorTiktok, input, maxItems);
}

/**
 * Um video especifico por URL (etapa 15, parte 1: curva do cliente, o link
 * que ele colou em "postei"). `postURLs` e o campo do `clockworks/
 * tiktok-scraper` para um alvo ja conhecido, ao lado de `hashtags` e
 * `profiles`; confirmado rodando com chave real em 05/09/2026 (pegou um
 * post de @tiktok pelo perfil e devolveu o mesmo post so com a URL dele).
 */
export async function buscarTiktokPorUrl(
  urls: string[],
): Promise<{ itens: TiktokItemBruto[]; devolvidos: number }> {
  if (urls.length === 0) return { itens: [], devolvidos: 0 };
  const input = { postURLs: urls, resultsPerPage: urls.length };
  return rodarAtor<TiktokItemBruto>(config.coleta.atorTiktok, input, urls.length);
}

/**
 * Item bruto do Instagram (apify/instagram-scraper), so os campos que a
 * normalizacao usa. `ownerFollowersCount` (E6 parte 3, item 4): nome de
 * campo nao confirmado contra uma resposta real do ator para post/reel
 * scrapado por `directUrls` (nesta rodada nenhuma chamada real ao Apify e
 * feita, `PROXIMO.md`); se o nome vier diferente quando a coleta voltar,
 * ajustar aqui, o resto do normalizador nao muda.
 */
export type InstagramItemBruto = {
  id: string;
  shortCode?: string;
  url: string;
  caption?: string;
  timestamp?: string;
  ownerUsername: string;
  ownerFullName?: string;
  ownerFollowersCount?: number;
  videoDuration?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
  likesCount?: number;
  commentsCount?: number;
  musicInfo?: { audio_id?: string; song_name?: string; artist_name?: string; uses_original_audio?: boolean };
};

/**
 * Busca por hashtag e por perfil vigiado, ambos via `directUrls` (a pagina
 * de explorar da hashtag e o perfil), decisao registrada em TODO.md porque
 * nao estava em nenhum documento do projeto: o campo `search` deste ator e
 * para descobrir hashtags/perfis por nome parecido, nao para coletar o
 * conteudo de um alvo ja conhecido; `directUrls` e o jeito documentado de
 * scrapar um alvo especifico (confirmado na loja da Apify, 02/09/2026).
 */
export async function buscarInstagram(
  hashtags: string[],
  perfis: string[],
  maxItens: number,
): Promise<{ itens: InstagramItemBruto[]; devolvidos: number }> {
  const directUrls = [
    ...hashtags.map((h) => `https://www.instagram.com/explore/tags/${encodeURIComponent(normalizarHashtag(h))}/`),
    ...perfis.map((p) => `https://www.instagram.com/${encodeURIComponent(p)}/`),
  ];
  if (directUrls.length === 0) return { itens: [], devolvidos: 0 };

  const input = { directUrls, resultsType: "reels", resultsLimit: maxItens };
  return rodarAtor<InstagramItemBruto>(config.coleta.atorInstagram, input, maxItens);
}

/**
 * Um post ou reel especifico por URL (etapa 15, parte 1: curva do
 * cliente). `directUrls` ja e o jeito documentado de scrapar um alvo
 * conhecido (comentario de `buscarInstagram` acima); um link de post
 * especifico e o mesmo mecanismo, so que a URL aponta para o proprio
 * video em vez do perfil ou da hashtag. Confirmado rodando com chave real
 * em 05/09/2026, inclusive que `/reel/{codigo}/` e `/p/{codigo}/` resolvem
 * o mesmo post (o job sempre reconstroi como `/reel/`, `medirInstagram` em
 * `curva-cliente.ts`).
 */
export async function buscarInstagramPorUrl(
  urls: string[],
): Promise<{ itens: InstagramItemBruto[]; devolvidos: number }> {
  if (urls.length === 0) return { itens: [], devolvidos: 0 };
  const input = { directUrls: urls, resultsType: "reels", resultsLimit: urls.length };
  return rodarAtor<InstagramItemBruto>(config.coleta.atorInstagram, input, urls.length);
}
