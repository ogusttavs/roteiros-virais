/** As extensões de route handler que o Next serve por padrão (o `next.config.ts` não define `pageExtensions`). Fonte única das conferências de rota. */
export const EXTENSOES_DE_ROTA = ["ts", "tsx", "js", "jsx"] as const;

/** O padrão de glob dos route handlers sob `base` (por exemplo `src/app/**`). */
export function padraoDeRota(base: string): string {
  return `${base}/route.{${EXTENSOES_DE_ROTA.join(",")}}`;
}
