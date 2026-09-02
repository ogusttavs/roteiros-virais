/**
 * Varre arquivo por arquivo usando as regras de src/lib/regras-de-texto.ts
 * (fonte unica, tambem usada pelo verificador de IA). Sem I/O de escrita
 * nem process.exit aqui, para dar para testar; o ponto de entrada de linha
 * de comando fica em checar-texto.ts.
 */
import { globSync, readFileSync } from "node:fs";

import { encontrarProblemas, EMOJI, JARGAO, TRAVESSAO } from "../src/lib/regras-de-texto";

export { EMOJI, JARGAO, TRAVESSAO };

export const PADROES = ["src/**/*.tsx", "src/textos/**/*.ts", "src/ia/prompts/**/*.ts"];

export type Problema = { arquivo: string; linha: number; motivo: string };

export function verificarLinha(linha: string): string[] {
  return encontrarProblemas(linha);
}

export function verificarArquivo(caminho: string): Problema[] {
  const conteudo = readFileSync(caminho, "utf8");
  return conteudo
    .split("\n")
    .flatMap((linha, i) =>
      verificarLinha(linha).map((motivo) => ({ arquivo: caminho, linha: i + 1, motivo })),
    );
}

export function listarArquivos(padroes: string[] = PADROES): string[] {
  const arquivos = new Set<string>();
  for (const padrao of padroes) {
    for (const arquivo of globSync(padrao)) arquivos.add(arquivo);
  }
  return [...arquivos].sort();
}
