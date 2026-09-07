import styles from "./Nota.module.css";
import { faixaDeNota } from "./notaFaixa";
import { faixaMeta, type FaixaMeta } from "./notaFaixaMeta";

export { faixaDeNota, type FaixaNota } from "./notaFaixa";

/** "baixa" existe nas duas faixas com cores diferentes (erro vs âmbar); classes separadas evitam a colisão. */
const CLASSE_FAIXA_META: Record<FaixaMeta, string> = {
  naMeta: styles.naMeta,
  neutra: styles.neutra,
  baixa: styles.baixaMeta,
};

type Props = {
  valor: number;
  /** Texto da faixa ("muito boa"), ja resolvido por quem chama (textosComuns.faixa). */
  legenda?: string;
  /** So no tamanho "lista": o que essa nota mede ("Para quem você vende"). */
  rotulo?: string;
  tamanho?: "destaque" | "lista";
  /**
   * Quando informada, a cor segue o design v2 (`base.css`, ".nota-linha"):
   * petróleo na meta, neutra abaixo, âmbar abaixo de 6, nunca vermelha. Sem
   * `meta`, mantém a faixa antiga (baixa/media/alta, erro/atencao/positivo)
   * que TemaLivreTela ainda usa, fora do escopo desta parte.
   */
  meta?: number;
};

/**
 * Numero grande em mono, com a faixa sempre em texto, nunca so por cor
 * (brief-frontend.md, secao 2). "destaque" (52px) para uma nota sozinha;
 * "lista" (31px) para uma linha dentro de uma lista de notas.
 */
export function Nota({ valor, legenda, rotulo, tamanho = "destaque", meta }: Props) {
  const classeFaixa = meta === undefined ? styles[faixaDeNota(valor)] : CLASSE_FAIXA_META[faixaMeta(valor, meta)];
  /** So a faixa por meta pinta o numero (design v2, ".na-meta .nota-valor"); a faixa antiga so pinta a legenda. */
  const classeNumero = meta === undefined ? "" : classeFaixa;
  const texto = valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  if (tamanho === "lista") {
    return (
      <div className={styles.linha}>
        <span className={[styles.numeroLista, classeNumero].filter(Boolean).join(" ")}>{texto}</span>
        <span className={styles.blocoLista}>
          {rotulo ? <span className={styles.rotulo}>{rotulo}</span> : null}
          {legenda ? <span className={[styles.legenda, classeFaixa].join(" ")}>{legenda}</span> : null}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.nota}>
      <span className={[styles.numeroDestaque, classeNumero].filter(Boolean).join(" ")}>{texto}</span>
      {legenda ? <span className={[styles.legenda, classeFaixa].join(" ")}>{legenda}</span> : null}
    </div>
  );
}
