"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import styles from "./BarraLateralToggle.module.css";

const CHAVE_ARMAZENAMENTO = "barra-lateral";
const ATRIBUTO = "data-barra-lateral";
/** Mesmo corte de 1100px do resto do painel (TemaCartao, HojeTela). */
const CONSULTA_AUTO_RECOLHIDA = "(max-width: 1099px)";

/**
 * Sem escolha salva, a barra decide sozinha pela largura: recolhida no
 * iPad (768 a 1099px), aberta a partir de 1100px (design v2, `PROXIMO.md`,
 * D2 parte 1, item 3). `layout.module.css` tem o mesmo corte em CSS puro
 * para o primeiro paint; esta função só precisa saber o estado atual para
 * decidir para que lado alternar.
 */
function estaRecolhidaAgora(): boolean {
  const atributo = document.documentElement.getAttribute(ATRIBUTO);
  if (atributo === "recolhida") return true;
  if (atributo === "aberta") return false;
  return window.matchMedia(CONSULTA_AUTO_RECOLHIDA).matches;
}

/** Uma vez que o cliente mexe no botão, a escolha fica salva e vale em qualquer largura. */
function alternar() {
  const raiz = document.documentElement;
  if (estaRecolhidaAgora()) {
    raiz.setAttribute(ATRIBUTO, "aberta");
    localStorage.setItem(CHAVE_ARMAZENAMENTO, "aberta");
  } else {
    raiz.setAttribute(ATRIBUTO, "recolhida");
    localStorage.setItem(CHAVE_ARMAZENAMENTO, "recolhida");
  }
}

type Props = { rotuloRecolher: string; rotuloAbrir: string };

/**
 * Dois botões, um só visível por vez via CSS (`html[data-barra-lateral]` ou,
 * sem escolha salva, o `@media` de `layout.module.css`), em vez de um botão
 * só com ícone/rótulo trocado por estado do React: o script em `layout.tsx`
 * (raiz) já decidiu o atributo antes da primeira pintura lendo o
 * `localStorage`, então os dois botões nascem no HTML do servidor sempre
 * iguais e a hidratação nunca diverge do que a CSS mostra.
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
