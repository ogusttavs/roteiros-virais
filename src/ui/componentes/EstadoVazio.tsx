"use client";

import type { ReactNode } from "react";

import styles from "./EstadoVazio.module.css";

type Props = {
  /**
   * O icone ja renderizado (`<Video size={24} strokeWidth={1.5} />`), nao o
   * componente. Um componente de icone e uma funcao, e uma funcao nao
   * atravessa a fronteira de servidor para cliente como prop (achado
   * rodando /fundacao, que passa esse icone de uma Server Component);
   * o elemento pronto atravessa sem problema.
   */
  icone: ReactNode;
  frase: string;
  acao?: { rotulo: string; onClick: () => void };
};

/** O que acontece aqui e o proximo passo, nunca "nenhum item" (brief-frontend.md, secao 2). */
export function EstadoVazio({ icone, frase, acao }: Props) {
  return (
    <div className={styles.estado}>
      {icone}
      <p className={styles.frase}>{frase}</p>
      {acao ? (
        <button type="button" className={styles.acao} onClick={acao.onClick}>
          {acao.rotulo}
        </button>
      ) : null}
    </div>
  );
}
