/**
 * E47 PR 2: o que a edição pela IA aceita do vídeo bruto e por quanto tempo guarda cada arquivo. Decisões do Gustavo em 29/10/2026 (valem acima do texto do estudo
 * `estrategia/e47-edicao-pela-ia.md`): sem música no servidor; o vídeo bruto é apagado sozinho em 48 horas e o editado em 7 dias; até 30 edições por mês por conta e vídeo de até 3 minutos.
 * O tamanho de 300 MB e a resolução de até 1080p vêm do mesmo estudo (seções 2.1 e 3.2).
 */
export const LIMITES_DA_EDICAO = {
  /** Tamanho do arquivo bruto, em bytes (a conta que os aparelhos mostram: 300 milhões). Na câmera do iPhone, 1080p dá uns 65 MB por minuto. */
  bytesMax: 300 * 1_000_000,
  megasMax: 300,
  /** Duração do bruto, em segundos. A tolerância cobre o iPhone, que grava 3 minutos como 180,03 s. */
  duracaoMaxS: 180,
  duracaoToleranciaS: 1,
  duracaoMinS: 3,
  /** "1080p" é o lado menor da imagem (1080x1920 em pé, 1920x1080 deitado). Acima disso o vídeo é recusado. */
  ladoMenorMax: 1080,
  /** Teto do lado maior, só para vídeo esticado demais (os aparelhos de hoje gravam até 2400 em 1080p). */
  ladoMaiorMax: 2560,
  /** Edições novas por conta em cada mês de Brasília. Uma que falhou antes de gastar (formato recusado, erro nosso) não conta. */
  edicoesPorMes: 30,
} as const;

/** O bruto some sozinho 48 horas depois que chegou inteiro. */
export const GUARDA_DO_BRUTO_MS = 48 * 60 * 60 * 1000;
/** O editado some sozinho 7 dias depois de pronto. */
export const GUARDA_DO_EDITADO_MS = 7 * 24 * 60 * 60 * 1000;
/** Uma edição que ficou em `subindo` por mais que isto (o celular dormiu, a aba fechou) falha e o arquivo parcial sai. */
export const ENVIO_DA_EDICAO_PARADO_APOS_MS = 45 * 60 * 1000;
/** Uma edição `guardado` que ninguém pegou (a fila perdeu o pedido) é enfileirada de novo depois deste tempo. */
export const TRANSCRICAO_ESQUECIDA_APOS_MS = 10 * 60 * 1000;
/** Uma edição `transcrevendo` por mais que isto (o worker caiu) falha. */
export const TRANSCRICAO_PARADA_APOS_MS = 30 * 60 * 1000;
/** Arquivo parcial (`.parte`) mais velho que isto é lixo de um envio que morreu. */
export const PARTE_VELHA_APOS_MS = 2 * 60 * 60 * 1000;

/** O fuso de Brasília não tem horário de verão desde 2019: o mês da cota começa à meia-noite UTC-3. */
export const DESLOCAMENTO_DE_BRASILIA_H = 3;

/** Quantas vezes o worker pega a mesma edição para transcrever antes de desistir (a fila repete 2 vezes: 3 ao todo). */
export const TENTATIVAS_DA_TRANSCRICAO = 3;
