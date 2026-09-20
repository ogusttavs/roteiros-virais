/**
 * Força da evidência que sustenta um roteiro (V4, roteiro sem vício, escopo
 * 5.12, item 8): calculada por código a partir da evidência que de fato
 * entrou no roteiro (nunca pela IA), para o cliente ver de onde veio, com a
 * fraca escrita sem esconder ("tema novo, pouca prova ainda", a frase da
 * seção 5.12). Limiares escolhidos para bater com a régua que o resto do
 * produto já usa: `LIMIAR_FORA_DA_CURVA` (1,5x) marca "fora da curva de
 * verdade" em `formatarNumero.ts`; o dobro disso (3x) é o que separa uma
 * evidência comum de uma que sustenta uma promessa forte. A proporção
 * brasileira mínima é a mesma da regra 70/30 (`config.regras.proporcaoBrasil`,
 * escopo 5.11), para a força nunca aprovar um roteiro sustentado
 * majoritariamente por vídeo internacional.
 */
import type { ForcaEvidencia } from "@/db/schema";
import { diasDesde, LIMIAR_FORA_DA_CURVA } from "@/lib/formatarNumero";

export const LIMIARES_FORCA_EVIDENCIA = {
  /** Menos que isso de vídeo, ou só uma conta, nunca é "forte" (é uma coincidência, não um padrão). */
  MINIMO_VIDEOS_FORTE: 3,
  MINIMO_CONTAS_FORTE: 2,
  /** O dobro do limiar de "fora da curva de verdade" (1,5x): não basta ter passado do normal, precisa ter passado bem. */
  MULTIPLO_MINIMO_FORTE: LIMIAR_FORA_DA_CURVA * 2,
  /** Evidência de mais de duas semanas não é "isto está funcionando agora" (escopo 5.12, item 6: "3 vídeos... nesta semana"). */
  DIAS_MAX_FORTE: 14,
  PROPORCAO_BRASIL_MINIMA_FORTE: 0.7,
  /** Abaixo disso, ou vídeo velho demais, a evidência não sustenta nada: fica fraca mesmo sem bater nenhum outro corte. */
  MINIMO_VIDEOS_MEDIA: 2,
  MINIMO_CONTAS_MEDIA: 2,
  DIAS_MAX_MEDIA: 30,
} as const;

export type EvidenciaParaForca = {
  contaId: number | null;
  foraDaCurva: number;
  publicadoEm: Date | null;
  contaBrasileira: boolean;
};

/**
 * Pura, testada com tabela de casos (V4, item 6). Sem nenhuma evidência,
 * devolve "fraca": quem chama decide se mostra a seção (o roteiro sem
 * evidência nenhuma já troca o cartão por outro aviso, `RoteiroTela.tsx`).
 * `agora` só existe para o teste fixar a data; quem chama de verdade nunca
 * precisa passar.
 */
export function forcaDaEvidencia(
  evidencias: readonly EvidenciaParaForca[],
  agora: Date = new Date(),
): ForcaEvidencia {
  if (evidencias.length === 0) return "fraca";

  const L = LIMIARES_FORCA_EVIDENCIA;
  const contasDistintas = new Set(
    evidencias.filter((e) => e.contaId !== null).map((e) => e.contaId),
  ).size;
  const maiorMultiplo = Math.max(...evidencias.map((e) => e.foraDaCurva));
  const idadeDoMaisNovoDias = Math.min(
    ...evidencias.map((e) => (e.publicadoEm ? diasDesde(e.publicadoEm, agora) : Infinity)),
  );
  const proporcaoBrasil = evidencias.filter((e) => e.contaBrasileira).length / evidencias.length;

  const forte =
    evidencias.length >= L.MINIMO_VIDEOS_FORTE &&
    contasDistintas >= L.MINIMO_CONTAS_FORTE &&
    maiorMultiplo >= L.MULTIPLO_MINIMO_FORTE &&
    idadeDoMaisNovoDias <= L.DIAS_MAX_FORTE &&
    proporcaoBrasil >= L.PROPORCAO_BRASIL_MINIMA_FORTE;
  if (forte) return "forte";

  const media =
    evidencias.length >= L.MINIMO_VIDEOS_MEDIA &&
    contasDistintas >= L.MINIMO_CONTAS_MEDIA &&
    idadeDoMaisNovoDias <= L.DIAS_MAX_MEDIA;
  return media ? "media" : "fraca";
}
