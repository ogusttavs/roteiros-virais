/**
 * Normalizador da Business Discovery da Meta (E6 parte 3, segunda rodada,
 * item 2): diferente dos outros tres (um item bruto = um video), aqui uma
 * chamada so devolve o perfil da conta MAIS ate 50 posts dela de uma vez,
 * entao a saida e uma conta e uma LISTA de videos.
 */
import type { BusinessDiscovery, HashtagRecentMediaItem } from "@/jobs/meta-api";

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

/**
 * O `id` da Business Discovery e o id numerico interno do post, diferente
 * do `shortCode` que o normalizador do Apify usa como `idExterno` (achado
 * comparando os dois: `apify/instagram-scraper` usa `shortCode`, a Meta so
 * devolve o id numerico). Sem isso, o mesmo post real viraria duas linhas
 * em `videos` se a conta trocar de fonte (Apify para a API). O `permalink`
 * segue o mesmo formato nas duas fontes (`instagram.com/p/<codigo>/` ou
 * `/reel/<codigo>/`), entao extrair o codigo dali mantem o `idExterno`
 * igual nas duas fontes.
 */
export function idExternoDoPermalink(permalink: string | undefined, idNumerico: string): string {
  const encontrado = permalink?.match(/\/(?:p|reel|tv)\/([^/]+)\/?/);
  return encontrado?.[1] ?? idNumerico;
}

/**
 * So video (media_type "VIDEO"), ou reel quando media_product_type vier
 * (a Business Discovery e o recent_media da hashtag as vezes marcam reels
 * so nesse campo; confirmado com uma resposta real do recent_media da
 * hashtag "limpeza", revisao do PR #35: os 38 VIDEO vieram todos com
 * `media_product_type = REELS`). Compartilhada entre os dois normalizadores
 * desta rodada, que usam o mesmo par de campos.
 */
export function ehVideo(item: { media_type?: string; media_product_type?: string }): boolean {
  return item.media_type === "VIDEO" || item.media_product_type === "REELS";
}

export function normalizarBusinessDiscovery(
  handle: string,
  discovery: BusinessDiscovery,
): { conta: ContaNormalizada; videos: VideoNormalizado[] } {
  const conta: ContaNormalizada = {
    plataforma: "instagram",
    handle,
    nome: discovery.username || handle,
    url: `https://www.instagram.com/${handle}`,
    seguidores: discovery.followers_count ?? null,
  };

  const videos = (discovery.media?.data ?? []).filter(ehVideo).map((item): VideoNormalizado => {
    const descricao = item.caption || null;
    const publicadoEm = item.timestamp ? new Date(item.timestamp) : null;
    return {
      plataforma: "instagram",
      idExterno: idExternoDoPermalink(item.permalink, item.id),
      url: item.permalink ?? `https://www.instagram.com/p/${item.id}/`,
      titulo: tituloDeVideo(descricao, handle, publicadoEm),
      descricao,
      publicadoEm,
      // A Business Discovery nao devolve duracao do video.
      duracaoS: null,
      views: item.view_count ?? 0,
      likes: item.like_count ?? 0,
      comentarios: item.comments_count ?? 0,
    };
  });

  return { conta, videos };
}

/**
 * Hashtag Search, pelo `recent_media` (item 3, ajuste 2 da revisao do PR
 * #35): sem conta dona nem views, so serve de sinal de assunto. `termo` (o
 * texto da hashtag buscada) entra so como identificador no titulo de
 * reserva de `tituloDeVideo`, que na pratica nunca deveria disparar aqui:
 * um item so chega ate este normalizador depois de passar no filtro de
 * video (`ehVideo`) e no filtro de Brasil (`temIndicioDeBrasil`), que exige
 * uma legenda com texto de verdade.
 */
export function normalizarHashtagMedia(item: HashtagRecentMediaItem, termo: string): VideoNormalizado {
  const descricao = item.caption || null;
  const publicadoEm = item.timestamp ? new Date(item.timestamp) : null;
  return {
    plataforma: "instagram",
    idExterno: idExternoDoPermalink(item.permalink, item.id),
    url: item.permalink ?? `https://www.instagram.com/p/${item.id}/`,
    titulo: tituloDeVideo(descricao, termo, publicadoEm),
    descricao,
    publicadoEm,
    // A Hashtag Search nunca devolve duracao nem views (so a Business Discovery devolve views).
    duracaoS: null,
    views: 0,
    likes: item.like_count ?? 0,
    comentarios: item.comments_count ?? 0,
  };
}
