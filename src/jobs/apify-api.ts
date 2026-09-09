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
 * Hashtag valida nao tem espaco (achado rodando com chave real: um termo
 * como "lente de contato dental" virou uma URL de hashtag do Instagram com
 * espaco codificado, que nao existe, e voltou sem resultado). O TikTok
 * aceita e normaliza sozinho; aqui normalizamos para os dois, para nao
 * depender de comportamento nao documentado de cada ator.
 */
function paraHashtag(termo: string): string {
  return termo.replace(/\s+/g, "");
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
 * Busca por hashtag (PROXIMO.md, decisao 2: os termos do nicho viram
 * hashtag) e por perfil vigiado, ambos num so input (o ator aceita os dois
 * campos juntos e cobra por resultado devolvido, nao por chamada).
 */
export async function buscarTiktok(
  hashtags: string[],
  perfis: string[],
  maxItems: number,
): Promise<{ itens: TiktokItemBruto[]; devolvidos: number }> {
  const numeroDeAlvos = hashtags.length + perfis.length;
  const input: Record<string, unknown> = { resultsPerPage: limitePorAlvo(maxItems, numeroDeAlvos) };
  if (hashtags.length > 0) input.hashtags = hashtags.map(paraHashtag);
  if (perfis.length > 0) input.profiles = perfis;
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
    ...hashtags.map((h) => `https://www.instagram.com/explore/tags/${encodeURIComponent(paraHashtag(h))}/`),
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
