import { LIMITES_DA_LEGENDA } from "@/config/publicacao";

/**
 * E56 PR 1: a conferência da legenda contra os limites do Instagram (2.200 letras, 30 hashtags, 20 marcações de @: `publicacao-ig-user-media.md`, parâmetro `caption`). Vale no servidor (que
 * recusa antes de falar com a Meta) e na folha de publicar (que avisa antes de enviar o vídeo), por isso mora numa função sem banco e sem Next.
 */
export type ProblemaDaLegenda = "legenda-longa" | "legenda-hashtags" | "legenda-marcacoes";

export function problemaDaLegenda(legenda: string): ProblemaDaLegenda | null {
  if ([...legenda].length > LIMITES_DA_LEGENDA.caracteres) return "legenda-longa";
  if ((legenda.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > LIMITES_DA_LEGENDA.hashtags) return "legenda-hashtags";
  if ((legenda.match(/@[\w.]+/g) ?? []).length > LIMITES_DA_LEGENDA.marcacoes) return "legenda-marcacoes";
  return null;
}
