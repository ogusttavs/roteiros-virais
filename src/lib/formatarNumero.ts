/**
 * Formatação de número para telas que citam vídeo de outra conta como
 * evidência (design v2, `PROXIMO.md`, D2 parte 1, item 5): "12 mil" em vez
 * de "12000", como o próprio Intl decide em português. Separado de
 * `src/textos/` porque não é texto fixo, é regra de formatação, testável
 * sem depender de nenhuma tela.
 */
const FORMATO_COMPACTO = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const FORMATO_EXATO = new Intl.NumberFormat("pt-BR");

/**
 * "12 mil", "1,2 mil", "3,4 mi", "999" (design v2, "de onde veio" e a
 * evidência do tema). O `Intl` do Node separa número e unidade com espaço
 * fino (U+00A0, achado rodando o teste); troca por espaço comum para não
 * ter dois caracteres visualmente iguais que não são o mesmo.
 */
export function formatarViewsCompacto(views: number): string {
  return FORMATO_COMPACTO.format(views).replace(/ /g, " ");
}

/** "1.240", sem arredondar: usado para o próprio vídeo do cliente (Hoje, "seu último vídeo"). */
export function formatarViewsExato(views: number): string {
  return FORMATO_EXATO.format(views);
}

/** "4,1x": o múltiplo fora da curva, uma casa decimal, sempre com o "x". */
export function formatarMultiplo(vezes: number): string {
  return `${vezes.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
}

/** Dias corridos entre uma data e agora, sem hora: 0 quando é hoje. */
export function diasDesde(data: Date, agora: Date = new Date()): number {
  const DIA_MS = 24 * 60 * 60 * 1000;
  const inicioData = new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
  const inicioAgora = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  return Math.max(0, Math.round((inicioAgora - inicioData) / DIA_MS));
}

/** "hoje", "ontem" ou "há N dias": nunca "em 0 dias" (revisão do PR #31, item 4). */
export function fraseDiasAtras(dias: number): string {
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return `em ${dias} dias`;
}

export type FaixaMultiplo = "acima" | "media" | "abaixo";

/**
 * A partir daqui é "acima do normal" (fora da curva de verdade). Exportado
 * como número (leitura prévia do Fable, acabamento do iPad, item 4): antes
 * `pesquisa.ts` tinha o mesmo 1,5 escrito à mão como string, e a régua da
 * consulta e a do cartão podiam divergir sem ninguém notar.
 */
export const LIMIAR_FORA_DA_CURVA = 1.5;

/**
 * Entre 0,8 e o limiar acima é "na média"; abaixo é "abaixo do normal"
 * (`BRIEF.md`, revisão de Referências; revisão do PR #31, item 4: o rótulo
 * do múltiplo sempre acompanha o número).
 */
export function classificarMultiplo(vezes: number): FaixaMultiplo {
  if (vezes >= LIMIAR_FORA_DA_CURVA) return "acima";
  if (vezes >= 0.8) return "media";
  return "abaixo";
}

/** "acima do normal dessa conta" / "na média dessa conta" / "abaixo do normal dessa conta". */
export function rotuloMultiploConta(faixa: FaixaMultiplo): string {
  if (faixa === "acima") return "acima do normal dessa conta";
  if (faixa === "media") return "na média dessa conta";
  return "abaixo do normal dessa conta";
}
