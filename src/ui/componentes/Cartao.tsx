import type { HTMLAttributes } from "react";

import styles from "./Cartao.module.css";

type Props = HTMLAttributes<HTMLDivElement> & {
  variante?: "superficie" | "recuado" | "destaque";
};

export function Cartao({ variante = "superficie", className, children, ...props }: Props) {
  const classes = [styles.cartao, styles[variante], className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
