import type { ButtonHTMLAttributes } from "react";

import styles from "./Botao.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "ghost" | "perigo";
  tamanho?: "md" | "lg";
  carregando?: boolean;
};

export function Botao({
  variante = "primario",
  tamanho = "md",
  carregando = false,
  disabled,
  children,
  className,
  ...props
}: Props) {
  const classes = [styles.botao, styles[variante], styles[tamanho], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} disabled={disabled ?? carregando} {...props}>
      {carregando ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
