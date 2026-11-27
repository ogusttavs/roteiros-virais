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
 * O limite de cada qualidade, em vezes a duração do vídeo, com piso e teto em milissegundos (T114). Medido no servidor em 26/11/2026 (`roteiros-render`, 1 vCPU): a prévia andou uns 0,28 s de vídeo por
 * segundo, ou seja, leva uns 3,6 vezes a duração (57 s de vídeo pediam uns 200 s, e o limite antigo de 3 vezes derrubou as duas tentativas perto de 85%). Seis vezes dá folga de 1,7 vez sobre o medido;
 * o piso de 3 minutos cobre o vídeo curto (30 s pedem uns 110 s) e o teto de 8 minutos só vale como trava (60 s, o vídeo mais longo, dão 6 minutos). O final tem quatro vezes os pixels da prévia
 * (a fase 0 mediu 2,3 vezes mais tempo na resolução cheia) e não foi medido no servidor: deve levar perto de 8 vezes a duração, então o limite antigo de 6 vezes também cairia; 12 vezes dá folga de 1,5.
 */
export const LIMITE_DO_RENDER_DA_ANIMACAO = {
  previa: { razao: 6, pisoMs: 180_000, tetoMs: 480_000 },
  final: { razao: 12, pisoMs: 180_000, tetoMs: 900_000 },
} as const satisfies Record<QualidadeDaAnimacao, { razao: number; pisoMs: number; tetoMs: number }>;

/** Tempo máximo do render inteiro (captura mais ffmpeg), em milissegundos: passou disso, algo travou e o render é derrubado (os números estão em `LIMITE_DO_RENDER_DA_ANIMACAO`). */
export function limiteDaAnimacaoMs(qualidade: QualidadeDaAnimacao, duracaoS: number): number {
  const { razao, pisoMs, tetoMs } = LIMITE_DO_RENDER_DA_ANIMACAO[qualidade];
  return Math.round(Math.min(tetoMs, Math.max(pisoMs, duracaoS * razao * 1000)));
}
