import styles from "./Progresso.module.css";

type Props = {
  /** "bloco 2 de 5", ja formatado por quem chama. */
  rotulo?: string;
  atual?: number;
  total?: number;
  /** Texto de espera da IA ("lendo a sua resposta"), ja formatado por quem chama. */
  mensagem?: string;
};

/** "bloco X de Y" com uma barra fina, ou o texto de espera da IA (brief-frontend.md, secao 7). */
export function Progresso({ rotulo, atual, total, mensagem }: Props) {
  if (mensagem) {
    return (
      <div className={styles.espera} role="status">
        <span className={styles.pulso} aria-hidden="true" />
        <span>{mensagem}</span>
      </div>
    );
  }

  if (rotulo && atual !== undefined && total !== undefined && total > 0) {
    const percentual = Math.round((Math.min(atual, total) / total) * 100);
    return (
      <div className={styles.passos}>
        <div className={styles.trilha}>
          <div className={styles.preenchido} style={{ width: `${percentual}%` }} />
        </div>
        <span className={styles.rotuloPassos}>{rotulo}</span>
      </div>
    );
  }

  return null;
}
