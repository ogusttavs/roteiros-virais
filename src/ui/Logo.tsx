import { config } from "@/lib/config";

/**
 * Espaco reservado do logo (brief-frontend.md, secao 4.3). Hoje e um simbolo
 * geometrico neutro. Trocar o SVG aqui troca o logo em todo o painel.
 */
export function Logo({ tamanho = 24 }: { tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={`ícone de ${config.appName}`}
    >
      <rect x="2" y="2" width="20" height="20" rx="6" stroke="var(--cor-acao)" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="var(--cor-destaque)" />
    </svg>
  );
}
