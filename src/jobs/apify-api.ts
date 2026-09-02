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

/** Roda um ator ate terminar e devolve os itens do dataset padrao da execucao. */
export async function rodarAtor<T>(ator: string, input: Record<string, unknown>, maxItems: number): Promise<T[]> {
  const execucao = await cliente().actor(ator).call(input, { maxItems });
  const { items } = await cliente().dataset(execucao.defaultDatasetId).listItems();
  return items as T[];
}

/** Item bruto do TikTok (clockworks/tiktok-scraper), so os campos que a normalizacao usa. */
export type TiktokItemBruto = {
  id: string;
  text?: string;
  webVideoUrl: string;
  createTimeISO?: string;
  authorMeta: { name: string; nickName?: string };
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
): Promise<TiktokItemBruto[]> {
  const input: Record<string, unknown> = { resultsPerPage: maxItems };
  if (hashtags.length > 0) input.hashtags = hashtags;
  if (perfis.length > 0) input.profiles = perfis;
  return rodarAtor<TiktokItemBruto>(config.coleta.atorTiktok, input, maxItems);
}

/** Item bruto do Instagram (apify/instagram-scraper), so os campos que a normalizacao usa. */
export type InstagramItemBruto = {
  id: string;
  shortCode?: string;
  url: string;
  caption?: string;
  timestamp?: string;
  ownerUsername: string;
  ownerFullName?: string;
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
): Promise<InstagramItemBruto[]> {
  const directUrls = [
    ...hashtags.map((h) => `https://www.instagram.com/explore/tags/${encodeURIComponent(h)}/`),
    ...perfis.map((p) => `https://www.instagram.com/${encodeURIComponent(p)}/`),
  ];
  if (directUrls.length === 0) return [];

  const input = { directUrls, resultsType: "reels", resultsLimit: maxItens };
  return rodarAtor<InstagramItemBruto>(config.coleta.atorInstagram, input, maxItens);
}
