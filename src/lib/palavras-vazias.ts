/**
 * Palavras curtas ou de ligação demais para contar como "elemento concreto" de um texto, ou para
 * casar etiqueta por acaso na evidência do tema e do roteiro (M5b, achado 6 da revisão do motor,
 * 01/10/2026: "para", "como" e "mais" casavam qualquer etiqueta que contivesse a subcadeia, e a
 * evidência virava "os 8 maiores do setor" em vez de relevância de verdade). Mesma lista que
 * `verificador.ts` já usava para o gancho do momento (V9a, item 2), agora compartilhada para as
 * duas nunca divergirem.
 *
 * Pequena de propósito: só o que apareceria demais e derrubaria a checagem ou a relevância por
 * acaso, não uma lista completa de preposições e artigos do português. Grafia com acento, a de
 * verdade; quem precisa comparar sem acento normaliza as duas pontas antes de usar (ver
 * `verificador.ts`).
 */
export const PALAVRAS_VAZIAS = new Set([
  "para",
  "pela",
  "pelo",
  "está",
  "estou",
  "estamos",
  "aqui",
  "isso",
  "essa",
  "esse",
  "muito",
  "muita",
  "hoje",
  "agora",
  "onde",
  "aonde",
  "sendo",
  "tendo",
  "depois",
  "antes",
  "porque",
  "porém",
  "então",
  "sobre",
  "ainda",
  "todo",
  "toda",
  "todos",
  "todas",
  "como",
  "mais",
  "deste",
  "desta",
  "neste",
  "nesta",
  "nesse",
  "nessa",
  "quando",
  "quanto",
  "sempre",
  "mesmo",
  "mesma",
  "outro",
  "outra",
  "outros",
  "outras",
  "cada",
]);
