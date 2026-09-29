"use client";

import { useId } from "react";

import styles from "./ClaqueteAnimada.module.css";

type Props = {
  /** A altura do desenho; a largura sai da proporção do símbolo (V11, item 1). */
  altura?: number;
};

/** Largura por altura do viewBox do símbolo (`entregaveis/design-v2/entrega/marca/marca.js`, `claquete()`, `arquivo: false`). */
const PROPORCAO = 84 / 78;

/**
 * A claquete do símbolo da marca (`marca.js`, `claquete()`), desenhada por
 * dentro (não `<img>`, V11, item 1): só assim a haste de cima pode bater.
 * `currentColor` na lousa e nas listras, o degradê de `--luz-a` a `--luz-b`
 * na tira acesa, iguais ao símbolo estático (`Simbolo`, `Logo.tsx`).
 * Decorativa; quem usa este componente escreve a informação de verdade ao
 * lado (`aria-hidden`).
 */
export function ClaqueteAnimada({ altura = 96 }: Props) {
  const id = useId();
  const idGradiente = `claquete-luz-${id}`;
  const idFiltro = `claquete-halo-${id}`;
  const largura = altura * PROPORCAO;

  return (
    <svg
      className={styles.claquete}
      width={largura}
      height={altura}
      viewBox="8 14 84 78"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={idGradiente} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" style={{ stopColor: "var(--luz-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--luz-b)" }} />
        </linearGradient>
        <filter id={idFiltro} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <g className={styles.braco}>
        <rect x="14" y="26" width="72" height="17" rx="3.5" fill={`url(#${idGradiente})`} filter={`url(#${idFiltro})`} opacity=".6" />
        <rect x="14" y="26" width="72" height="17" rx="3.5" fill={`url(#${idGradiente})`} />
        <path d="M33 26h11l-7 17h-11z M57 26h11l-7 17h-11z" fill="currentColor" />
      </g>
      <rect x="14" y="48" width="72" height="40" rx="7" fill="currentColor" />
    </svg>
  );
}
