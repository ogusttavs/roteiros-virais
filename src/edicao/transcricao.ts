/**
 * E47 PR 3: a fala da pessoa como o modelo a lê e como o código a compara. Tudo puro, sem rede e sem banco.
 *
 * O modelo nunca recebe nem devolve segundo: ele lê uma palavra por linha, com o NÚMERO dela (o índice na lista de palavras da edição), e responde com números. Quem converte número em tempo
 * é o motor de corte (`cortes.ts`). Uma pausa grande entre duas palavras vira uma linha de aviso, porque é nela que quase sempre acaba uma tentativa e começa outra.
 */
import type { PalavraFalada } from "./tipos";

/** Vão entre duas palavras acima disto (segundos) aparece na transcrição como uma linha de pausa. */
export const PAUSA_QUE_APARECE_S = 0.7;

/** Uma palavra para dentro de uma linha do prompt: sem quebra de linha, sem a barra que separa os campos e sem os sinais que abrem ou fecham marcação. */
export function palavraParaPrompt(texto: string): string {
  return texto.replace(/[<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function segundos(valor: number): string {
  return (Math.round(valor * 10) / 10).toFixed(1);
}

/**
 * A transcrição em linhas `indice|inicio|palavra`, com `~ pausa de N.N s` entre duas palavras separadas por mais de `PAUSA_QUE_APARECE_S`. Palavra vazia depois de limpar ainda ocupa o
 * seu índice (o índice é a posição na lista, nunca muda).
 */
export function linhasDaTranscricao(palavras: PalavraFalada[]): string {
  const linhas: string[] = [];
  palavras.forEach((p, i) => {
    if (i > 0) {
      const vao = p.inicio - palavras[i - 1].fim;
      if (vao > PAUSA_QUE_APARECE_S) linhas.push(`~ pausa de ${segundos(vao)} s`);
    }
    linhas.push(`${i}|${segundos(p.inicio)}|${palavraParaPrompt(p.texto)}`);
  });
  return linhas.join("\n");
}

/** O texto corrido de um pedaço da fala (as palavras dos índices dados, em ordem). */
export function textoDosIndices(palavras: PalavraFalada[], indices: number[]): string {
  return indices
    .map((i) => palavras[i]?.texto ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minúscula, sem acento, sem pontuação e sem espaço nas pontas: a forma em que dois textos são comparados. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distância de edição entre dois textos curtos (inserir, tirar ou trocar uma letra custa 1). */
export function distanciaDeEdicao(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo);
    }
    anterior = atual;
  }
  return anterior[b.length];
}
