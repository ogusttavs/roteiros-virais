import { config } from "@/lib/config";

/**
 * Espaco reservado do logo (entrega/README.md): circulo em linha, 24 px.
 * Troca pelo SVG da marca quando ela existir; nenhuma tela referencia isso
 * direto (brief-frontend.md, secao 4.3).
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
      <circle cx="12" cy="12" r="11.25" stroke="var(--cor-titulo)" strokeWidth="1.5" />
    </svg>
  );
}
