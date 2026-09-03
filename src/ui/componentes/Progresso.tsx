"use client";

import { useEffect, useState } from "react";

import styles from "./Progresso.module.css";

type Props = {
  /** "bloco 2 de 5", ja formatado por quem chama. */
  rotulo?: string;
  atual?: number;
  total?: number;
  /** Uma mensagem fixa de espera. */
  mensagem?: string;
  /** Ou uma lista que troca sozinha a cada `intervaloMs` (textosComuns.espera). */
  frases?: string[];
  intervaloMs?: number;
};

/**
 * "bloco X de Y" com uma trilha segmentada, ou o texto de espera da IA
 * (brief-frontend.md, secao 7). `frases` roda sozinho quando tem mais de uma;
 * `mensagem` fica fixa. Rotulo, mensagem e frases ja vem formatados de quem
 * chama, o componente nunca escreve texto.
 */
export function Progresso({ rotulo, atual, total, mensagem, frases, intervaloMs = 4000 }: Props) {
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    if (!frases || frases.length < 2) return;
    const id = setInterval(() => setIndice((i) => (i + 1) % frases.length), intervaloMs);
    return () => clearInterval(id);
  }, [frases, intervaloMs]);

  if (mensagem || frases) {
    const texto = mensagem ?? frases?.[indice % (frases?.length ?? 1)];
    return (
      <div className={styles.espera} role="status" aria-live="polite">
        <span className={styles.pulso} aria-hidden="true" />
        <span>{texto}</span>
      </div>
    );
  }

  if (rotulo && atual !== undefined && total !== undefined && total > 0) {
    const segmentos = Array.from({ length: total }, (_, i) => i < atual);
    return (
      <div className={styles.passos}>
        <span className={styles.rotuloPassos}>{rotulo}</span>
        <div className={styles.trilha} role="progressbar" aria-valuenow={atual} aria-valuemin={0} aria-valuemax={total}>
          {segmentos.map((preenchido, i) => (
            <span key={i} className={preenchido ? styles.segmentoCheio : styles.segmentoVazio} />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
