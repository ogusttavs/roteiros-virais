/**
 * E74 PR 2a: os pedidos de geração (`pedidos_de_geracao`). Um pedido nasce quando a pessoa toca em "Escrever", com o id que o navegador gerou, e anda pelas etapas até ficar pronto ou falhar. O
 * desenho está em `estrategia/e74-aba-em-andamento.md` (seções 2 e 3); aqui só os nomes e os números.
 */

/** O vídeo de animação continua na tabela `animacoes` (seção 3.4 do desenho): aqui só o roteiro (as três versões) e o carrossel. */
export const TIPOS_DE_PEDIDO = ["roteiro", "carrossel"] as const;
export type TipoDePedido = (typeof TIPOS_DE_PEDIDO)[number];

/** `na_vez` só existe quando a escrita passar para o worker (PR 2b); no PR 2a o pedido nasce em `lendo`. */
export const ESTADOS_DO_PEDIDO = ["na_vez", "lendo", "escrevendo", "conferindo", "pronto", "falhou"] as const;
export type EstadoDoPedido = (typeof ESTADOS_DO_PEDIDO)[number];

/** Os estados em que o pedido ainda anda (a mesma lista do índice único parcial `pedidos_um_em_andamento_por_tipo`). */
export const ESTADOS_EM_ANDAMENTO = ["na_vez", "lendo", "escrevendo", "conferindo"] as const satisfies readonly EstadoDoPedido[];
export type EstadoEmAndamento = (typeof ESTADOS_EM_ANDAMENTO)[number];

export function estaEmAndamento(estado: string): estado is EstadoEmAndamento {
  return (ESTADOS_EM_ANDAMENTO as readonly string[]).includes(estado);
}

/**
 * Sem batimento (`atualizado_em`) há mais que isto, o pedido é dado como parado pela varredura (seção 3.3): o roteiro em 6 minutos (a tela promete até 4; o grupo em escrita já valia 5) e o
 * carrossel em 5. A decisão de 26/11/2026 é que o parado se resolva sozinho (PR 2b, a retomada); no PR 2a a varredura é o último recurso.
 */
export const PRAZO_SEM_BATIMENTO_MS: Record<TipoDePedido, number> = {
  roteiro: 6 * 60_000,
  carrossel: 5 * 60_000,
};

/** Quantas etapas o roteiro mostra ("Etapa 2 de 3"): lendo a pesquisa, escrevendo, conferindo. */
export const ETAPAS_DO_ROTEIRO = 3;

/** O número da etapa (1 a 3) de cada estado em andamento do roteiro; `na_vez` é antes da primeira. */
export function numeroDaEtapa(estado: EstadoEmAndamento): number {
  if (estado === "escrevendo") return 2;
  if (estado === "conferindo") return 3;
  return 1;
}

/** De quantos pedidos prontos dos últimos 30 dias o tempo típico passa a vir do que foi medido (seção 5); antes disso, os números de `TEMPO_TIPICO_INICIAL_S`. */
export const MINIMO_PARA_O_TEMPO_MEDIDO = 20;
export const DIAS_DO_TEMPO_MEDIDO = 30;
/** O tempo típico é um número do produto, nunca de uma marca: calculado uma vez e guardado por 10 minutos. */
export const GUARDA_DO_TEMPO_TIPICO_MS = 10 * 60_000;

/** A faixa "costuma levar de X a Y", em segundos, enquanto não há medição bastante: o roteiro do PR #299 (30 s a 2 min) e o carrossel (até 2 min). */
export const TEMPO_TIPICO_INICIAL_S: Record<TipoDePedido, { de: number; ate: number }> = {
  roteiro: { de: 30, ate: 120 },
  carrossel: { de: 30, ate: 120 },
};

/** Por quantos dias um pedido pronto ainda não visto e uma falha não dispensada aparecem para a pessoa (a mesma janela do grupo em aberto: o dia e o seguinte). */
export const DIAS_DO_PEDIDO_NA_TELA = 2;

/** O deploy espera os pedidos em andamento terminarem por até este tempo antes de recriar o app e o worker (R-n). O `deploy/deploy.sh` usa o mesmo número. */
export const ESPERA_DO_DEPLOY_S = 240;
