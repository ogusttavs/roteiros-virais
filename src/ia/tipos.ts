import type { NivelIA } from "@/config/precos-ia";

export type { NivelIA };

/** As nove tarefas do plano (plano de execucao, etapa 4). */
export type TarefaIA =
  | "avaliarResposta"
  | "compilarPerfil"
  | "extrairVideo"
  | "analisarVisual"
  | "modeloNicho"
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
