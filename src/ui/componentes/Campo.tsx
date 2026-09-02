import { useId, type InputHTMLAttributes } from "react";

import styles from "./Campo.module.css";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string;
  ajuda?: string;
  erro?: string;
};

export function Campo({ rotulo, ajuda, erro, className, ...props }: Props) {
  const id = useId();
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;

  return (
    <div className={styles.grupo}>
      <label className={styles.rotulo} htmlFor={id}>
        {rotulo}
      </label>
      {ajuda ? (
        <span className={styles.ajuda} id={idAjuda}>
          {ajuda}
        </span>
      ) : null}
      <input
        id={id}
        className={[styles.entrada, erro ? styles.comErro : "", className]
          .filter(Boolean)
          .join(" ")}
        aria-describedby={[idAjuda, idErro].filter(Boolean).join(" ") || undefined}
        aria-invalid={Boolean(erro)}
        {...props}
      />
      {erro ? (
        <span className={styles.erro} id={idErro} role="alert">
          {erro}
        </span>
      ) : null}
    </div>
  );
}
