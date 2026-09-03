import styles from "./Constancia.module.css";

type Numero = { valor: string; rotulo: string };

type Props = {
  numeros: Numero[];
  /** Um ponto por dia, true quando gravou naquele dia (HistoricoTela). */
  dias: boolean[];
  rotuloDias: string;
};

/** Os números do mês e a linha de 30 dias (HistoricoTela). */
export function Constancia({ numeros, dias, rotuloDias }: Props) {
  return (
    <div className={styles.constancia}>
      <div className={styles.numeros}>
        {numeros.map((numero) => (
          <div key={numero.rotulo} className={styles.bloco}>
            <span className={styles.valor}>{numero.valor}</span>
            <span className={styles.rotulo}>{numero.rotulo}</span>
          </div>
        ))}
      </div>
      <div role="img" aria-label={rotuloDias} className={styles.linha}>
        {dias.map((gravou, indice) => (
          <span
            key={indice}
            className={[styles.dia, gravou ? styles.gravou : "", indice === dias.length - 1 ? styles.hoje : ""]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </div>
    </div>
  );
}
