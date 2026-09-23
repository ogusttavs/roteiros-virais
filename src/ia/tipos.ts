import type { NivelIA } from "@/config/precos-ia";

export type { NivelIA };

/**
 * As dez tarefas do plano (plano de execucao, etapas 4 e 10), mais
 * `classificarAbertura` (V4, item 2: backfill do tipo de abertura de
 * analise ja existente, sem ler transcricao de novo), `lerMomento` (V9a,
 * item 3: separa os campos do momento a partir da transcricao ou do texto
 * digitado na folha "Gravar agora"), `lerAgenda` (V9b, item 1: separa a
 * agenda colada ou falada em dias) e `planejarDia` (V9b, item 2: sugere de
 * 1 a 3 gravacoes por dia do plano).
 */
export type TarefaIA =
  | "avaliarResposta"
  | "compilarPerfil"
  | "extrairVideo"
  | "analisarVisual"
  | "modeloNicho"
  | "filtrarNoticias"
  | "temasDoDia"
  | "avaliarTema"
  | "roteiro"
  | "verificarTexto"
  | "aprenderCliente"
  | "classificarAbertura"
  | "lerMomento"
  | "lerAgenda"
  | "planejarDia";

export type ImagemEntrada = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type EsforcoIA = "low" | "medium" | "high";

export type ResultadoGeracao<T> = {
  dados: T;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
};
