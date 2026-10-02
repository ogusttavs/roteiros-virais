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

/**
 * Achado rodando a regra contra `#100` (revisão do PR #100, 02/10/2026): um comentário citando um
 * número de PR de três dígitos ou mais sempre bate com o padrão de cor de hexadecimal (todo dígito
 * decimal também é um dígito hexadecimal válido), um falso positivo que só piora conforme os PRs
 * passam de 99. Comentário de bloco (`/* ... *\/`) nunca é CSS de verdade, então o conteúdo dele
 * vira espaço antes de aplicar `VALOR_SOLTO`, preservando as quebras de linha para o número da
 * linha do problema continuar certo.
 */
export function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "));
}

export function verificarArquivo(caminho: string): Problema[] {
  if (ARQUIVOS_PERMITIDOS.includes(caminho)) return [];
  const conteudo = readFileSync(caminho, "utf8");
  return semComentarios(conteudo)
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
