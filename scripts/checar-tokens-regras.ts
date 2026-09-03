/**
 * Confere que nenhuma cor esta escrita direto num CSS de componente ou tela
 * (etapa D, parte 1, PROXIMO.md item 7): todo valor vem de tokens.css. Sem
 * I/O de escrita nem process.exit aqui, para dar para testar; o ponto de
 * entrada de linha de comando fica em checar-tokens.ts.
 */
import { globSync, readFileSync } from "node:fs";

export const PADROES = ["src/ui/componentes/**/*.css", "src/app/**/*.css"];

/** tokens.css e onde as cores nascem; o resto do app so referencia var(--...). */
export const ARQUIVOS_PERMITIDOS = ["src/ui/tokens.css"];

const VALOR_SOLTO = /#[0-9a-fA-F]{3,6}\b|rgba?\(/;

export type Problema = { arquivo: string; linha: number; motivo: string };

export function verificarLinha(linha: string): string[] {
  return VALOR_SOLTO.test(linha) ? ["cor solta fora de tokens.css; use var(--cor-...)"] : [];
}

export function verificarArquivo(caminho: string): Problema[] {
  if (ARQUIVOS_PERMITIDOS.includes(caminho)) return [];
  const conteudo = readFileSync(caminho, "utf8");
  return conteudo
    .split("\n")
    .flatMap((linha, i) => verificarLinha(linha).map((motivo) => ({ arquivo: caminho, linha: i + 1, motivo })));
}

export function listarArquivos(padroes: string[] = PADROES): string[] {
  const arquivos = new Set<string>();
  for (const padrao of padroes) {
    for (const arquivo of globSync(padrao)) arquivos.add(arquivo);
  }
  return [...arquivos].sort();
}
