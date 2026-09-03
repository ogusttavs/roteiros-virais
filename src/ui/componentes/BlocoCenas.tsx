import styles from "./BlocoCenas.module.css";

export type Cena = { momento: string; oQueFazer: string };

type Props = {
  titulo: string;
  cenas: Cena[];
};

/** Onde gravar e o que mostrar, em bloco recuado (RoteiroTela). */
export function BlocoCenas({ titulo, cenas }: Props) {
  return (
    <section className={styles.secao}>
      <h2 className={styles.titulo}>{titulo}</h2>
      <ol className={styles.lista}>
        {cenas.map((cena) => (
          <li key={cena.momento} className={styles.item}>
            <span className={styles.momento}>{cena.momento}</span>
            <span className={styles.oQueFazer}>{cena.oQueFazer}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
