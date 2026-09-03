/**
 * Regra de qual item da Nav fica marcado, separada de Nav.tsx (sem JSX
 * neste arquivo, mesmo motivo de notaFaixa.ts).
 */
export function ehRotaAtiva(pathname: string | null, href: string): boolean {
  return pathname === href;
}
