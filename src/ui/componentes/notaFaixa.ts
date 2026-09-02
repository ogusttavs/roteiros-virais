/**
 * Regra da faixa da nota, separada de Nota.tsx (sem JSX neste arquivo) para
 * dar para testar com vitest sem passar pelo transform de JSX: o tsconfig do
 * projeto usa `jsx: "preserve"` (o Next.js faz o proprio transform), e o
 * Vitest nao consegue importar um .tsx com isso.
 */
export type FaixaNota = "baixa" | "media" | "alta";

/**
 * Abaixo de 5, de 5 a 8, e de 8 em diante (brief-frontend.md, secao 7). A
 * variante nunca depende so da cor: quem usa Nota sempre passa uma legenda
 * lida a partir da faixa.
 */
export function faixaDeNota(valor: number): FaixaNota {
  if (valor < 5) return "baixa";
  if (valor < 8) return "media";
  return "alta";
}
