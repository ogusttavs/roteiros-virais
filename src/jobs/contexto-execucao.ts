/**
 * O contexto da execução em andamento (custo que falta no admin): `executarComRegistro` abre um contexto com o id da linha de `execucoes_job` e o ramo (quando o job roda por ramo), e quem
 * grava um custo no meio do job (a transcrição pela Groq, a coleta pelo Apify, `registrarCustoExterno`) lê dali de que execução e de que ramo o gasto é, sem precisar receber esses ids por
 * toda a cadeia de chamadas. Fora de uma execução (script, teste, a rota de transcrição do momento), não há contexto e os dois ficam nulos.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type ContextoDaExecucao = {
  execucaoId: number;
  /** O ramo desta execução; um job que percorre vários ramos vai trocando (`definirRamoDoContexto`) e fora disso fica nulo. */
  ramoId: number | null;
};

const armazenamento = new AsyncLocalStorage<ContextoDaExecucao>();

/** O ramo com que a execução começou (nulo quando rodou para todos): o que vale de novo depois de um laço por ramos. */
const ramoDeOrigem = new WeakMap<ContextoDaExecucao, number | null>();

export function comContextoDaExecucao<T>(contexto: ContextoDaExecucao, fazer: () => Promise<T>): Promise<T> {
  const copia = { ...contexto };
  ramoDeOrigem.set(copia, contexto.ramoId);
  return armazenamento.run(copia, fazer);
}

export function contextoDaExecucao(): ContextoDaExecucao | undefined {
  return armazenamento.getStore();
}

/** Um job que percorre vários ramos diz em qual está agora, para o custo gravado daqui em diante ser dele. Sem contexto (fora de uma execução), não faz nada. */
export function definirRamoDoContexto(ramoId: number | null): void {
  const contexto = armazenamento.getStore();
  if (contexto) contexto.ramoId = ramoId;
}

/** Ao sair de um laço por ramos, o custo seguinte volta a ser o do ramo da execução (ou de nenhum), e não o do último ramo do laço. */
export function restaurarRamoDoContexto(): void {
  const contexto = armazenamento.getStore();
  if (contexto) contexto.ramoId = ramoDeOrigem.get(contexto) ?? null;
}
