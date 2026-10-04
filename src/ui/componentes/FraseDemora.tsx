"use client";

import { useEffect, useState } from "react";

import { textosComuns } from "@/textos/comuns";

import styles from "./FraseDemora.module.css";

/** Passo 16, capítulo 5: aos 8 segundos de espera, uma linha embaixo do esqueleto. Nunca erro antes de erro. */
const ESPERA_MS = 8000;

/**
 * A linha dos 8 segundos embaixo de um esqueleto (`FraseDemora.module.css`). Só entra na tela (e no leitor de tela, `role="status"`) quando o tempo chega: se a
 * tela real chega antes, o esqueleto e este componente somem juntos e nada é dito.
 */
export function FraseDemora() {
  const [passou, setPassou] = useState(false);
  useEffect(() => {
    const espera = setTimeout(() => setPassou(true), ESPERA_MS);
    return () => clearTimeout(espera);
  }, []);
  if (!passou) return null;
  return (
    <p className={styles.frase} role="status">
      {textosComuns.demorandoMaisQueNormal}
    </p>
  );
}
