/**
 * Regra de qual chip fica marcado num grupo, separada de Chips.tsx (sem JSX
 * neste arquivo, mesmo motivo de notaFaixa.ts). `selecionado` e um unico
 * indice (ou nulo), entao o tipo ja garante no maximo um marcado por grupo;
 * esta funcao e o que o componente usa para decidir cada chip.
 */
export function chipsAtivos(quantidade: number, selecionado: number | null): boolean[] {
  return Array.from({ length: quantidade }, (_, i) => i === selecionado);
}
