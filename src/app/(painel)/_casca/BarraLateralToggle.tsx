"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import styles from "./BarraLateralToggle.module.css";

const CHAVE_ARMAZENAMENTO = "barra-lateral";
const ATRIBUTO = "data-barra-lateral";

function alternar() {
  const raiz = document.documentElement;
  const recolhida = raiz.getAttribute(ATRIBUTO) === "recolhida";
  if (recolhida) {
    raiz.removeAttribute(ATRIBUTO);
    localStorage.setItem(CHAVE_ARMAZENAMENTO, "aberta");
  } else {
    raiz.setAttribute(ATRIBUTO, "recolhida");
    localStorage.setItem(CHAVE_ARMAZENAMENTO, "recolhida");
  }
}

type Props = { rotuloRecolher: string; rotuloAbrir: string };

/**
 * Dois botões, um só visível por vez via CSS (`html[data-barra-lateral]`),
 * em vez de um botão só com ícone/rótulo trocado por estado do React: o
 * script em `layout.tsx` (raiz) já decidiu o atributo antes da primeira
 * pintura lendo o `localStorage`, então os dois botões nascem no HTML do
 * servidor sempre iguais e a hidratação nunca diverge do que a CSS mostra.
 */
export function BarraLateralToggle({ rotuloRecolher, rotuloAbrir }: Props) {
  return (
    <div className={styles.linha}>
      <button
        type="button"
        aria-label={rotuloRecolher}
        onClick={alternar}
        className={`${styles.botao} ${styles.recolher}`}
      >
        <PanelLeftClose size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={rotuloAbrir}
        onClick={alternar}
        className={`${styles.botao} ${styles.abrir}`}
      >
        <PanelLeftOpen size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
