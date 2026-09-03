import styles from "./PilarLinha.module.css";

export type Pilar = { nome: string; valor: number; porque: string };

/** Uma linha de pilar: nome, barra fina de 0 a 10, numero, justificativa (entrega/README.md). */
export function PilarLinha({ nome, valor, porque }: Pilar) {
  const texto = valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <li className={styles.linha}>
      <div className={styles.medida}>
        <span className={styles.nome}>{nome}</span>
        <span
          role="progressbar"
          aria-valuenow={valor}
          aria-valuemin={0}
          aria-valuemax={10}
          aria-label={nome}
          className={styles.trilha}
        >
          <span className={styles.preenchido} style={{ width: `${valor * 10}%` }} />
        </span>
        <span className={styles.valor}>{texto}</span>
      </div>
      <p className={styles.porque}>{porque}</p>
    </li>
  );
}

/** Os cinco pilares da nota de tema (escopo 4.3), em ordem fixa. */
export function Pilares({ pilares }: { pilares: Pilar[] }) {
  return (
    <ul className={styles.lista}>
      {pilares.map((pilar) => (
        <PilarLinha key={pilar.nome} {...pilar} />
      ))}
    </ul>
  );
}
