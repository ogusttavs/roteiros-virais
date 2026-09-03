/**
 * Regra da trilha segmentada de Progresso, separada de Progresso.tsx (sem
 * JSX neste arquivo, mesmo motivo de notaFaixa.ts): o tsconfig usa
 * `jsx: "preserve"` e o Vitest nao importa um .tsx com isso.
 */
export function segmentosPreenchidos(atual: number, total: number): boolean[] {
  return Array.from({ length: total }, (_, i) => i < atual);
}
