/**
 * Faixa da nota relativa a uma meta (design v2, `entrega/telas/base.css`,
 * ".nota-linha"; `PROXIMO.md`, D2 parte 2, item 1): petróleo na meta, neutra
 * abaixo dela, âmbar abaixo de 6, nunca vermelha. Separado de `notaFaixa.ts`
 * (que fica como está, com os nomes "baixa/media/alta" e as cores
 * erro/atencao/positivo de antes) porque aquela funcao ainda e usada por
 * TemaLivreTela, fora do escopo desta parte; misturar as duas mudaria a cor
 * de uma tela que ninguem revisou nesta rodada.
 */
export type FaixaMeta = "naMeta" | "neutra" | "baixa";

const LIMITE_BAIXA = 6;

export function faixaMeta(valor: number, meta: number): FaixaMeta {
  if (valor >= meta) return "naMeta";
  if (valor < LIMITE_BAIXA) return "baixa";
  return "neutra";
}
