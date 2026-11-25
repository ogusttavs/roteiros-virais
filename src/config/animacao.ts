/**
 * E68 A1: os números do vídeo de animação de texto. Vêm da medição da fase 0 (`entregaveis/revisoes/fase0-render-animacao-2026-11-25.md`): quadros em JPEG (cinco a sete vezes mais rápido que PNG
 * em 1080 por 1920), 30 quadros por segundo, a prévia na metade do tamanho e o final inteiro.
 */
export type QualidadeDaAnimacao = "previa" | "final";

/** O desenho da cena é sempre em 1080 por 1920 (CSS); a prévia só reduz a foto (fator 0,5), então o texto quebra nas mesmas linhas nas duas qualidades. */
export const LARGURA_DA_CENA = 1080;
export const ALTURA_DA_CENA = 1920;
export const QUADROS_POR_SEGUNDO = 30;

export const AJUSTES_DA_ANIMACAO = {
  previa: { fator: 0.5, qualidadeDoJpeg: 85, crf: 26, preset: "ultrafast" },
  final: { fator: 1, qualidadeDoJpeg: 90, crf: 20, preset: "veryfast" },
} as const;

/** Limites do que o cliente (ou o verificador) pode mandar: o texto vem do roteiro, então cabe em bloco curto. */
export const LIMITES_DA_ANIMACAO = {
  maxCenas: 24,
  maxCaracteresPorCena: 140,
  duracaoMinimaDaCenaS: 1.5,
  duracaoMaximaDaCenaS: 8,
  duracaoMaximaTotalS: 60,
  /** Tempo de leitura: segundos por palavra, com o piso e o teto acima. */
  segundosPorPalavra: 0.38,
  /** Tempo de entrada e de saída de cada bloco, em segundos. */
  entradaS: 0.4,
  saidaS: 0.3,
} as const;

/**
 * Tempo máximo do render inteiro (captura mais ffmpeg), em milissegundos. A fase 0 mediu 1,6 minuto para 30 s de final, e o servidor deve ser 1,5 a 2 vezes mais lento; o limite é seis vezes a duração
 * do vídeo para o final (com piso de 2 minutos) e três vezes para a prévia (piso de 1 minuto), com teto de 15 minutos: passou disso, algo travou e o render é derrubado.
 */
export function limiteDaAnimacaoMs(qualidade: QualidadeDaAnimacao, duracaoS: number): number {
  const razao = qualidade === "final" ? 6 : 3;
  const piso = qualidade === "final" ? 120_000 : 60_000;
  return Math.round(Math.min(900_000, Math.max(piso, duracaoS * razao * 1000)));
}
