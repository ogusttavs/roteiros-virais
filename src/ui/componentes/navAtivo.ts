/**
 * Regra de qual item da Nav fica marcado, separada de Nav.tsx (sem JSX
 * neste arquivo, mesmo motivo de notaFaixa.ts).
 */
export function ehRotaAtiva(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  // A rota e o que está dentro dela: em /criar/temas ou /criar/tema-livre a aba Criar continua acesa (A2, item 6: estando em Criar, a aba ativa não se destacava).
  return pathname === href || pathname.startsWith(`${href}/`);
}
