"use client";

import { CircleAlert } from "lucide-react";

import estiloErro from "./EstadoErro.module.css";
import styles from "./EstadoVazio.module.css";

type Props = {
  frase: string;
  acao?: { rotulo: string; onClick: () => void };
};

/** Mesma forma de EstadoVazio, com o icone e a cor de erro (entrega/README.md). */
export function EstadoErro({ frase, acao }: Props) {
  return (
    <div className={styles.estado}>
      <CircleAlert size={24} strokeWidth={1.5} className={estiloErro.icone} aria-hidden="true" />
      <p className={styles.frase}>{frase}</p>
      {acao ? (
        <button type="button" className={styles.acao} onClick={acao.onClick}>
          {acao.rotulo}
        </button>
      ) : null}
    </div>
  );
}
