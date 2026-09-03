"use client";

import { useId, type TextareaHTMLAttributes } from "react";

import styles from "./AreaTexto.module.css";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  rotulo: string;
  ajuda?: string;
  erro?: string;
  /** Ja formatado ("128 caracteres") por quem chama. */
  contador?: string;
  /** Linhas visiveis antes de crescer com o texto (entrega/README.md). */
  linhasMin?: number;
};

/** Igual a Campo, mas cresce com o texto (`field-sizing: content`, entrega/README.md). */
export function AreaTexto({ rotulo, ajuda, erro, contador, linhasMin = 3, className, ...props }: Props) {
  const id = useId();
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;

  return (
    <div className={styles.grupo}>
      <span className={styles.linhaRotulo}>
        <label className={styles.rotulo} htmlFor={id}>
          {rotulo}
        </label>
        {contador ? <span className={styles.contador}>{contador}</span> : null}
      </span>
      {ajuda ? (
        <span className={styles.ajuda} id={idAjuda}>
          {ajuda}
        </span>
      ) : null}
      <textarea
        id={id}
        rows={linhasMin}
        className={[styles.area, erro ? styles.comErro : "", className].filter(Boolean).join(" ")}
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
