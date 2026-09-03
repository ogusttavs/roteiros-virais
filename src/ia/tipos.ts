import type { NivelIA } from "@/config/precos-ia";

export type { NivelIA };

/** As dez tarefas do plano (plano de execucao, etapas 4 e 10). */
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
  | "verificarTexto";

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
