"use client";

import { Check, CircleAlert } from "lucide-react";
import { useEffect } from "react";

import styles from "./Toast.module.css";

type Props = {
  texto: string;
  aberto: boolean;
  onFechar: () => void;
  duracaoMs?: number;
  /**
   * "erro" (V7, item 4): o aviso de falha de uma ação (rede caiu, servidor
   * não respondeu). Ícone de alerta em vez de "feito", `role="alert"` para o
   * leitor de tela anunciar na hora, e fica mais tempo na tela por padrão.
   */
  variante?: "sucesso" | "erro";
};

/**
 * Confirmacao curta, sem bloquear, some sozinho (entrega/README.md). Fica
 * acima da barra fixa da tela: `--toast-base` (definido por cada tela, com a
 * altura da barra) mais a área segura de baixo do aparelho. Não captura toque
 * (`pointer-events: none`), para nunca cobrir um botão que a pessoa precisa
 * tocar de novo.
 */
export function Toast({ texto, aberto, onFechar, duracaoMs, variante = "sucesso" }: Props) {
  const duracao = duracaoMs ?? (variante === "erro" ? 5000 : 3000);

  useEffect(() => {
    if (!aberto) return;
    const id = setTimeout(onFechar, duracao);
    return () => clearTimeout(id);
  }, [aberto, duracao, onFechar]);

  if (!aberto) return null;

  const Icone = variante === "erro" ? CircleAlert : Check;
  return (
    <div role={variante === "erro" ? "alert" : "status"} className={styles.toast}>
      <Icone size={18} strokeWidth={1.5} aria-hidden="true" />
      {texto}
    </div>
  );
}
