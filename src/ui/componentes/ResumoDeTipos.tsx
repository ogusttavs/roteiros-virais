import styles from "./ListaDeTipos.module.css";

type Props = {
  ligados: number;
  total: number;
  /** A segunda parte do resumo: "como a gente sugere", "3 trocados por você", "respondido em 3 de outubro". */
  complemento: string;
};

/** O resumo de cima da lista ("9 ligados de 13", "3 trocados por você"), com a contagem em negrito (`.resumo-formatos` do passo 17). */
export function ResumoDeTipos({ ligados, total, complemento }: Props) {
  return (
    <p className={styles.resumo} aria-live="polite">
      <span>
        <b>{ligados}</b> ligados de {total}
      </span>
      <span>{complemento}</span>
    </p>
  );
}
