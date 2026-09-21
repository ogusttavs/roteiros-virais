import { faixaMeta } from "./notaFaixaMeta";
import styles from "./NotaLinha.module.css";

export type Pilar = { nome: string; valor: number; porque: string; meta: number };

const CLASSE_FAIXA: Record<ReturnType<typeof faixaMeta>, string> = {
  naMeta: styles.naMeta,
  neutra: "",
  baixa: styles.baixa,
};

/**
 * Uma linha de pilar no design v2 (`entrega/telas/base.css`, ".nota-linha"):
 * nome, número, barra fina e a justificativa numa frase, com a cor da luz da
 * marca na meta, neutra abaixo, âmbar quando baixa (`notaFaixaMeta.ts`,
 * mesma régua de `Nota`). Substitui o `PilarLinha` antigo (barra de 2 px,
 * cores erro/atenção/positivo) nas telas já na pele nova (V5b, item 4).
 */
export function NotaLinha({ nome, valor, porque, meta }: Pilar) {
  const texto = valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const classeFaixa = CLASSE_FAIXA[faixaMeta(valor, meta)];

  return (
    <div className={[styles.linha, classeFaixa].filter(Boolean).join(" ")}>
      <span className={styles.nome}>{nome}</span>
      <span className={styles.valor}>{texto}</span>
      <span
        className={styles.barra}
        role="progressbar"
        aria-valuenow={valor}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-label={nome}
      >
        <span className={styles.barraPreenchida} style={{ width: `${valor * 10}%` }} />
      </span>
      <p className={styles.palavra}>{porque}</p>
    </div>
  );
}

/** Os cinco pilares da nota de tema (escopo 4.3), em ordem fixa. */
export function NotasLinha({ pilares }: { pilares: Pilar[] }) {
  return (
    <div className={styles.pilares}>
      {pilares.map((pilar) => (
        <NotaLinha key={pilar.nome} {...pilar} />
      ))}
    </div>
  );
}
