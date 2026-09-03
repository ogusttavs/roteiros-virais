"use client";

import { Check } from "lucide-react";
import { useEffect } from "react";

import styles from "./Toast.module.css";

type Props = {
  texto: string;
  aberto: boolean;
  onFechar: () => void;
  duracaoMs?: number;
};

/** Confirmacao curta, sem bloquear, some sozinho (entrega/README.md). */
export function Toast({ texto, aberto, onFechar, duracaoMs = 3000 }: Props) {
  useEffect(() => {
    if (!aberto) return;
    const id = setTimeout(onFechar, duracaoMs);
    return () => clearTimeout(id);
  }, [aberto, duracaoMs, onFechar]);

  if (!aberto) return null;

  return (
    <div role="status" className={styles.toast}>
      <Check size={18} strokeWidth={1.5} aria-hidden="true" />
      {texto}
    </div>
  );
}
