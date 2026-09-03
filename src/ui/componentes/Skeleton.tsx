import type { CSSProperties } from "react";

import styles from "./Skeleton.module.css";

type Props = {
  variante?: "titulo" | "corpo" | "numero" | "video";
  /** Sobrescreve a largura padrao da variante (ex.: "60%", "38%"). */
  largura?: string;
  className?: string;
};

/** Um bloco por vez (entrega/README.md); quem monta a tela empilha varios. */
export function Skeleton({ variante = "corpo", largura, className }: Props) {
  const style: CSSProperties | undefined = largura ? { width: largura } : undefined;
  return (
    <div className={[styles.skeleton, styles[variante], className].filter(Boolean).join(" ")} style={style} aria-hidden="true" />
  );
}
