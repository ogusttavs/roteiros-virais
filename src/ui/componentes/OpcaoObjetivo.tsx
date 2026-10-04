"use client";

import styles from "./OpcaoObjetivo.module.css";

type Props = {
  titulo: string;
  /** Sem subtitulo quando a pergunta ja e curta o bastante sozinha (DadosFixosForm). */
  ajuda?: string;
  /** E49 PR 1: a linha "Por exemplo: ..." das fichas. */
  exemplo?: string;
  /** E49 PR 1: a linha discreta "Ajuda em: ..." das fichas, o objetivo antigo em palavras de gente. */
  ajudaEm?: string;
  marcada: boolean;
  recomendada?: boolean;
  rotuloRecomendado?: string;
  onEscolher: () => void;
};

/**
 * Uma das opcoes grandes de um grupo de escolha unica, com a bolinha de
 * radio a esquerda (design v2, `entrega/telas/base.css`, ".opcao"; role="radio",
 * ObjetivoFluxo, DadosFixosForm).
 */
export function OpcaoObjetivo({ titulo, ajuda, exemplo, ajudaEm, marcada, recomendada = false, rotuloRecomendado, onEscolher }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={onEscolher}
      className={[styles.opcao, marcada ? styles.marcada : ""].filter(Boolean).join(" ")}
    >
      <span className={[styles.bolinha, marcada ? styles.bolinhaMarcada : ""].filter(Boolean).join(" ")} aria-hidden="true" />
      <span className={styles.textos}>
        {recomendada && rotuloRecomendado ? <span className={styles.recomendado}>{rotuloRecomendado}</span> : null}
        <span className={styles.titulo}>{titulo}</span>
        {ajuda ? <span className={styles.ajuda}>{ajuda}</span> : null}
        {exemplo ? (
          <span className={styles.exemplo}>
            <span className={styles.prefixo}>Por exemplo: </span>
            {exemplo}
          </span>
        ) : null}
        {ajudaEm ? <span className={styles.ajudaEm}>Ajuda em: {ajudaEm}</span> : null}
      </span>
    </button>
  );
}
