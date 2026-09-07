import type { ReactNode } from "react";

import styles from "./BarraTopo.module.css";

type Props = {
  titulo: string;
  /** Botão de voltar, por exemplo (design v2, `Roteiro.dc.html`). */
  esquerda?: ReactNode;
  direita?: ReactNode;
};

/**
 * Barra fixa no topo da tela, com o nome da tela (design v2,
 * `entrega/telas/base.css`, `.barra-topo`; `PROXIMO.md`, D2 parte 1, item 3).
 * Por enquanto só Hoje e Roteiro usam: as outras telas continuam com a
 * casca antiga até a parte delas da integração.
 */
export function BarraTopo({ titulo, esquerda, direita }: Props) {
  return (
    <header className={styles.barra}>
      {esquerda}
      <span className={styles.titulo}>{titulo}</span>
      {direita ? <span className={styles.direita}>{direita}</span> : null}
    </header>
  );
}
