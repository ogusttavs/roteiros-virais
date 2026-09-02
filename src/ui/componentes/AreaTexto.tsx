import { useId, type TextareaHTMLAttributes } from "react";

import styles from "./AreaTexto.module.css";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  titulo: string;
  ajuda?: string;
  erro?: string;
  /** Ja formatado ("128 caracteres") por quem chama. */
  contador?: string;
};

/** Pergunta em título, ajuda em texto suave, área grande, contador discreto (brief-frontend.md, 6.2). */
export function AreaTexto({ titulo, ajuda, erro, contador, className, ...props }: Props) {
  const id = useId();
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;

  return (
    <div className={styles.grupo}>
      <label className={styles.titulo} htmlFor={id}>
        {titulo}
      </label>
      {ajuda ? (
        <span className={styles.ajuda} id={idAjuda}>
          {ajuda}
        </span>
      ) : null}
      <textarea
        id={id}
        className={[styles.area, erro ? styles.comErro : "", className].filter(Boolean).join(" ")}
        aria-describedby={[idAjuda, idErro].filter(Boolean).join(" ") || undefined}
        aria-invalid={Boolean(erro)}
        {...props}
      />
      <div className={styles.rodape}>
        {erro ? (
          <span className={styles.erro} id={idErro} role="alert">
            {erro}
          </span>
        ) : (
          <span />
        )}
        {contador ? <span className={styles.contador}>{contador}</span> : null}
      </div>
    </div>
  );
}
