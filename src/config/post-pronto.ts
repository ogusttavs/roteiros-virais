/**
 * E56 PR 2: o que a Meta aceita de um post pronto de imagem ou carrossel, copiado da documentação oficial baixada em `pesquisa/plataformas/docs/meta/` (`publicacao-ig-user-media.md`: imagem em
 * JPEG, de 4:5 a 1,91:1, até 8 MB; `publicacao-de-conteudo.md`: "Em um período de 24 horas, as contas podem fazer no máximo 50 publicações. Publicar um carrossel conta como um único post").
 * O produto limita o carrossel a 10 imagens (a Meta aceita até 20), por decisão do Gustavo em 25/11/2026. Trocar um número aqui sem a fonte quebra a fonte da verdade.
 */

export const LIMITES_DO_POST_PRONTO = {
  imagensMin: 1,
  imagensMax: 10,
  /** O JPEG que vai para a Meta: no máximo 8 MB (milhões de bytes, a conta que os aparelhos mostram). */
  bytesDoJpegMax: 8 * 1_000_000,
  /** O arquivo que a pessoa escolhe (PNG pesa mais que o JPEG em que ele vira): o teto é só para não encher a memória. */
  bytesDoArquivoMax: 25 * 1_000_000,
  /** A proporção (largura dividida pela altura): de 4:5 (0,8) a 1,91:1. A folga de 1% cobre o arredondamento dos aplicativos de design. */
  proporcaoMin: 0.8,
  proporcaoMax: 1.91,
  folgaDaProporcao: 0.01,
  /** A soma dos arquivos de um pedido. */
  bytesDoPedidoMax: 120 * 1_000_000,
} as const;

/** O intervalo padrão entre dois posts da fila, em minutos (`PUBLICAR_INTERVALO_MIN`). */
export const INTERVALO_PADRAO_ENTRE_POSTS_MIN = 10;

/** O que a Meta tem para preparar uma imagem (bem menos que um vídeo): passou disso, o post falha com "demorou" e a pessoa pode pôr na fila de novo. */
export const PREPARO_DA_IMAGEM_PRAZO_MS = 2 * 60 * 1000;
export const ESPERA_ENTRE_CONFERENCIAS_DA_IMAGEM_MS = 4000;
/** Mandamos publicar e a resposta nunca chegou: depois disto o post é tratado como "não confirmado" (nunca se tenta publicar de novo sozinho). */
export const POST_PUBLICANDO_PARADO_APOS_MS = 5 * 60 * 1000;

/** A chave que abre a função (desligada por padrão). Lida na hora, para o teste poder ligar e desligar. */
export function publicarImagensAtivo(): boolean {
  const valor = (process.env.PUBLICAR_IMAGENS_ATIVO ?? "").trim().toLowerCase();
  return valor === "1" || valor === "true" || valor === "sim";
}

export function intervaloEntrePostsMin(): number {
  const texto = process.env.PUBLICAR_INTERVALO_MIN;
  if (texto === undefined || texto.trim() === "") return INTERVALO_PADRAO_ENTRE_POSTS_MIN;
  const bruto = Number(texto);
  return Number.isFinite(bruto) && bruto >= 0 ? bruto : INTERVALO_PADRAO_ENTRE_POSTS_MIN;
}
