import styles from "./Nota.module.css";
import { faixaDeNota } from "./notaFaixa";

export { faixaDeNota, type FaixaNota } from "./notaFaixa";

type Props = {
  valor: number;
  /** Texto da faixa ("muito boa"), ja resolvido por quem chama (textosComuns.faixa). */
  legenda?: string;
  /** So no tamanho "lista": o que essa nota mede ("Para quem você vende"). */
  rotulo?: string;
  tamanho?: "destaque" | "lista";
};

/**
 * Numero grande em mono, com a faixa sempre em texto, nunca so por cor
 * (brief-frontend.md, secao 2). "destaque" (52px) para uma nota sozinha;
 * "lista" (31px) para uma linha dentro de uma lista de notas.
 */
export function Nota({ valor, legenda, rotulo, tamanho = "destaque" }: Props) {
  const faixa = faixaDeNota(valor);
  const texto = valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  if (tamanho === "lista") {
    return (
      <div className={styles.linha}>
        <span className={styles.numeroLista}>{texto}</span>
        <span className={styles.blocoLista}>
          {rotulo ? <span className={styles.rotulo}>{rotulo}</span> : null}
          {legenda ? <span className={[styles.legenda, styles[faixa]].join(" ")}>{legenda}</span> : null}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.nota}>
      <span className={styles.numeroDestaque}>{texto}</span>
      {legenda ? <span className={[styles.legenda, styles[faixa]].join(" ")}>{legenda}</span> : null}
    </div>
  );
}
