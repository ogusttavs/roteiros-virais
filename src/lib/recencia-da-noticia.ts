/**
 * Há quanto tempo a notícia saiu, em texto de gente ("há 40 min", "há 3 h", "ontem"), calculado da data da matéria. Puro, sem banco: a capa das Notícias e os testes usam a mesma conta.
 * O dia é o de São Paulo (sem horário de verão desde 2019, o deslocamento é fixo em -03:00).
 */
const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;
const FUSO = "America/Sao_Paulo";

/** Até quantas horas desde a publicação a notícia ganha o selo "saiu agora". */
export const HORAS_DO_SELO_SAIU_AGORA = 2;

function diaEmSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

/** A matéria saiu há menos de 2 horas (e não está no futuro além da tolerância de relógio de 1 hora). */
export function saiuAgora(publicadoEm: Date | null | undefined, agora: Date = new Date()): boolean {
  if (!publicadoEm || Number.isNaN(publicadoEm.getTime())) return false;
  const idade = agora.getTime() - publicadoEm.getTime();
  return idade >= -HORA_MS && idade < HORAS_DO_SELO_SAIU_AGORA * HORA_MS;
}

export function recenciaDaNoticia(publicadoEm: Date | null | undefined, agora: Date = new Date()): string {
  if (!publicadoEm || Number.isNaN(publicadoEm.getTime())) return "";
  const idade = agora.getTime() - publicadoEm.getTime();
  if (idade < HORA_MS) return `há ${Math.max(1, Math.floor(idade / MINUTO_MS))} min`;
  if (idade < DIA_MS) return `há ${Math.floor(idade / HORA_MS)} h`;
  const ontem = diaEmSaoPaulo(new Date(agora.getTime() - DIA_MS));
  const dia = diaEmSaoPaulo(publicadoEm);
  if (dia === ontem) return "ontem";
  if (dia === diaEmSaoPaulo(new Date(agora.getTime() - 2 * DIA_MS))) return "anteontem";
  return `há ${Math.max(2, Math.floor(idade / DIA_MS))} dias`;
}
