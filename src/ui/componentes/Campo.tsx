import { useId, type InputHTMLAttributes } from "react";

import styles from "./Campo.module.css";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string;
  ajuda?: string;
  erro?: string;
  /** Ja formatado ("20/60") por quem chama. */
  contador?: string;
  /** Ex.: "@", mostrado grudado a esquerda do campo. */
  prefixo?: string;
};

export function Campo({ rotulo, ajuda, erro, contador, prefixo, className, ...props }: Props) {
  const id = useId();
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;

  const entrada = (
    <input
      id={id}
      className={[styles.entrada, erro ? styles.comErro : "", prefixo ? styles.comPrefixo : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-describedby={[idAjuda, idErro].filter(Boolean).join(" ") || undefined}
      aria-invalid={Boolean(erro)}
      {...props}
    />
  );

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
      {prefixo ? (
        <span className={styles.envoltorioPrefixo}>
          <span className={styles.prefixo} aria-hidden="true">
            {prefixo}
          </span>
          {entrada}
        </span>
      ) : (
        entrada
      )}
      {erro ? (
        <span className={styles.erro} id={idErro} role="alert">
          {erro}
        </span>
      ) : null}
    </div>
  );
}
