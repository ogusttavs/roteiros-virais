import type { TipoDePublicacao } from "@/db/schema";

/**
 * E56 PR 1: o que a Meta aceita de um vídeo publicado pela API, copiado da documentação oficial baixada em `pesquisa/plataformas/docs/meta/publicacao-ig-user-media.md` (baixada em
 * 23/10/2026: "Especificações de reel" e "Especificações de vídeos para story") e de `publicacao-de-conteudo.md` (a legenda). Trocar um número aqui sem a fonte quebra a fonte da verdade.
 * Tamanhos em milhões de bytes (a conta que os aparelhos mostram), o que deixa a conferência do nosso lado um pouco mais apertada que a da Meta, nunca mais frouxa.
 */
export const LIMITES_DA_PUBLICACAO: Record<TipoDePublicacao, { bytesMax: number; megasMax: number; segundosMin: number; segundosMax: number }> = {
  reels: { bytesMax: 300 * 1_000_000, megasMax: 300, segundosMin: 3, segundosMax: 15 * 60 },
  story: { bytesMax: 100 * 1_000_000, megasMax: 100, segundosMin: 3, segundosMax: 60 },
};

/** Contêiner aceito: MOV ou MP4 (os dois tipos que a Meta lista). A extensão vale quando o aparelho não diz o tipo. */
export const TIPOS_DE_VIDEO_ACEITOS = ["video/mp4", "video/quicktime"] as const;
export const EXTENSOES_DE_VIDEO_ACEITAS = [".mp4", ".mov"] as const;

/** A legenda: no máximo 2.200 caracteres, 30 hashtags e 20 marcações de @ (`publicacao-ig-user-media.md`, parâmetro `caption`). */
export const LIMITES_DA_LEGENDA = { caracteres: 2200, hashtags: 30, marcacoes: 20 } as const;

/** Quanto tempo um envio sem fim fica reservando o roteiro antes de a próxima tentativa poder passar por cima dele (um vídeo de 300 MB num celular lento leva muito). */
export const ENVIO_PARADO_APOS_MS = 45 * 60 * 1000;
/** Depois de mandar publicar, a resposta da Meta não pode demorar mais que isto; passou, o resultado é tratado como "não confirmado" (nunca se tenta publicar de novo sozinho). */
export const PUBLICANDO_PARADO_APOS_MS = 3 * 60 * 1000;
/** A espera, em segundos, entre as conferências de "o vídeo já está pronto?" (a Meta pede no máximo uma por minuto, por até 5 minutos: `publicacao-de-conteudo.md`, "Status de publicação do contêiner"). */
export const ESPERAS_DA_CONFERENCIA_S = [10, 20, 30, 45, 60, 60, 60, 60, 60] as const;

/** Quando o limite de publicações por dia não puder ser lido na Meta: a documentação do ponto `content_publishing_limit` diz 50 por 24 horas (o guia diz 100; vale o menor). */
export const LIMITE_DE_PUBLICACOES_PADRAO = 50;

export function tipoDeVideoAceito(tipo: string, nomeDoArquivo?: string): boolean {
  const t = tipo.trim().toLowerCase();
  if (t) return (TIPOS_DE_VIDEO_ACEITOS as readonly string[]).includes(t);
  const nome = (nomeDoArquivo ?? "").toLowerCase();
  return EXTENSOES_DE_VIDEO_ACEITAS.some((e) => nome.endsWith(e));
}
