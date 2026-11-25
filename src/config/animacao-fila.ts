/**
 * E68 A2: os números e os estados da fila do vídeo de animação (o plano B do dia em que a pessoa não consegue gravar). Os números do motor (qualidade, limites das cenas) ficam em
 * `config/animacao.ts`; aqui só o que é da fila: estados, tentativas, guarda dos arquivos e quanto tempo a tela diz que leva.
 */
export const ESTADOS_DA_ANIMACAO = ["pedida", "fazendo_previa", "previa_pronta", "fazendo_final", "final_pronta", "falhou"] as const;
export type EstadoDaAnimacao = (typeof ESTADOS_DA_ANIMACAO)[number];

/** Os estados em que a marca já tem uma animação em andamento (a mesma lista do índice único parcial da tabela, `animacoes_uma_em_andamento_por_marca`). */
export const ESTADOS_EM_ANDAMENTO = ["pedida", "fazendo_previa", "previa_pronta", "fazendo_final"] as const;

/** Quantas vezes o render tenta cada passo (prévia e final contam separado) antes de a animação falhar de vez. */
export const TENTATIVAS_DA_ANIMACAO = 2;
/** O que o render espera para tentar de novo depois de uma falha, em segundos. */
export const ESPERA_ENTRE_TENTATIVAS_S = 30;

/** O vídeo final fica 7 dias para a pessoa baixar, como o editado (decisão de 29/10/2026). */
export const GUARDA_DO_FINAL_MS = 7 * 24 * 3_600_000;
/** A prévia que ninguém aprovou nem dispensou sai em 48 horas. */
export const GUARDA_DA_PREVIA_MS = 48 * 3_600_000;
/** O pedido que falhou fica 7 dias na tela ("Tentar de novo") e depois sai. */
export const GUARDA_DA_FALHA_MS = 7 * 24 * 3_600_000;
/** Esperando a vez há mais que isto (a fila perdeu): a limpeza enfileira de novo. */
export const ANIMACAO_ESQUECIDA_APOS_MS = 10 * 60 * 1000;
/** Montando sem sinal há mais que isto (o contêiner caiu): volta para a vez. */
export const ANIMACAO_PARADA_APOS_MS = 40 * 60 * 1000;
/** O arquivo sem dono só sai depois disto (o que acabou de ser renomeado ainda não teve o caminho gravado). */
export const IDADE_MINIMA_DO_ARQUIVO_SEM_DONO_MS = 10 * 60 * 1000;

/** O tempo que a tela diz que leva, em segundos: a prévia (fase 0: 30 a 45 s em 1 CPU) e o final (3 a 5 minutos no servidor, a conta é da duração). */
export function tempoEsperadoDaPreviaS(duracaoS: number): number {
  return Math.max(30, Math.round(duracaoS * 1.5));
}
export function tempoEsperadoDoFinalS(duracaoS: number): number {
  return Math.max(120, Math.round(duracaoS * 10));
}
