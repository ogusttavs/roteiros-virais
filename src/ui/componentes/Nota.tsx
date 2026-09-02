import styles from "./Nota.module.css";
import { faixaDeNota } from "./notaFaixa";

export { faixaDeNota, type FaixaNota } from "./notaFaixa";

type Props = {
  valor: number;
  legenda?: string;
  rotulo?: string;
  tamanho?: "md" | "lg";
};

export function Nota({ valor, legenda, rotulo, tamanho = "md" }: Props) {
  const faixa = faixaDeNota(valor);
  const texto = valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <div className={[styles.nota, styles[tamanho]].join(" ")}>
      <span className={[styles.numero, styles[faixa]].join(" ")}>{texto}</span>
      {legenda ? <span className={styles.legenda}>{legenda}</span> : null}
      {rotulo ? <span className={styles.rotulo}>{rotulo}</span> : null}
    </div>
  );
}
