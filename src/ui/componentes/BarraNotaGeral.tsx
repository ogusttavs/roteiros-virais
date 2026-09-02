import styles from "./BarraNotaGeral.module.css";

type Props = {
  notaAtual: number;
  meta: number;
  rotuloNotaAtual: string;
  rotuloMeta: string;
  dica?: string;
};

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Barra fina fixa no topo no celular, cartao estatico no desktop (a
 * responsividade e so CSS, brief-frontend.md 6.2). A dica ja vem formatada
 * de quem chama; o componente nao escreve texto.
 */
export function BarraNotaGeral({ notaAtual, meta, rotuloNotaAtual, rotuloMeta, dica }: Props) {
  const atingiu = notaAtual >= meta;
  const classes = [styles.barra, atingiu ? styles.atingiu : ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <div className={styles.notas}>
        <span className={styles.bloco}>
          <span className={styles.numero}>{formatarNota(notaAtual)}</span>
          <span className={styles.rotulo}>{rotuloNotaAtual}</span>
        </span>
        <span className={styles.bloco}>
          <span className={styles.numero}>{formatarNota(meta)}</span>
          <span className={styles.rotulo}>{rotuloMeta}</span>
        </span>
      </div>
      {dica ? <p className={styles.dica}>{dica}</p> : null}
    </div>
  );
}
