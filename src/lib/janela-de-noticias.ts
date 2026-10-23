/**
 * A janela de data das notícias (fix de 22/10/2026, Notícias): notícia publicada há mais de 7 dias, ou sem data, nunca é candidata ao filtro nem aparece na tela. O Google News devolve matéria
 * de meses atrás misturada à de hoje, e a coleta grava por `coletado_em`: sem esta regra, 6 das 8 "relevantes" de um dia eram de dezembro a setembro. Puro, sem banco, para o filtro, a lista e
 * os testes usarem a mesma conta.
 */
const DIA_MS = 24 * 60 * 60 * 1000;

/** Há quantos dias, no máximo, uma notícia ainda interessa. */
export const DIAS_MAXIMOS_DA_NOTICIA = 7;
/** A data de publicação pode vir um pouco adiantada por fuso; mais que isto no futuro é data errada. */
export const TOLERANCIA_DE_FUTURO_MS = DIA_MS;

/** O instante mais antigo que ainda vale: 7 dias antes de `agora`. */
export function inicioDaJanelaDeNoticias(agora: Date = new Date()): Date {
  return new Date(agora.getTime() - DIAS_MAXIMOS_DA_NOTICIA * DIA_MS);
}

/** Uma notícia só disputa o filtro (e a tela) se tem data de publicação, dentro dos últimos 7 dias, e não adiantada demais. */
export function noticiaEhCandidata(publicadoEm: Date | null | undefined, agora: Date = new Date()): boolean {
  if (!publicadoEm || Number.isNaN(publicadoEm.getTime())) return false;
  return publicadoEm.getTime() >= inicioDaJanelaDeNoticias(agora).getTime() && publicadoEm.getTime() <= agora.getTime() + TOLERANCIA_DE_FUTURO_MS;
}
