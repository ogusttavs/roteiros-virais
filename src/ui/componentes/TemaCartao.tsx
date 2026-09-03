import styles from "./TemaCartao.module.css";

type Props = {
  /** Ex.: "para te chamarem". */
  rotulo: string;
  tema: string;
  porque: string;
  /** Ja formatado ("5 vídeos fora da curva esta semana"). */
  evidencia: string;
  /** O tema recomendado do dia: botao preenchido em vez de linha. */
  primario?: boolean;
  rotuloBotao: string;
  onEscolher: () => void;
};

/** Um tema do dia, com evidencia e o rotulo de objetivo (entrega/README.md, HojeCelular). */
export function TemaCartao({ rotulo, tema, porque, evidencia, primario = false, rotuloBotao, onEscolher }: Props) {
  return (
    <article className={[styles.cartao, primario ? styles.primario : ""].filter(Boolean).join(" ")}>
      <span className={styles.rotulo}>{rotulo}</span>
      <h2 className={styles.tema}>{tema}</h2>
      <p className={styles.porque}>{porque}</p>
      <div className={styles.rodape}>
        <span className={styles.evidencia}>{evidencia}</span>
        <button
          type="button"
          onClick={onEscolher}
          className={[styles.botao, primario ? styles.botaoPrimario : styles.botaoSecundario].join(" ")}
        >
          {rotuloBotao}
        </button>
      </div>
    </article>
  );
}
