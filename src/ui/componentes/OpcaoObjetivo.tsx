import { Check } from "lucide-react";

import styles from "./OpcaoObjetivo.module.css";

type Props = {
  titulo: string;
  ajuda: string;
  marcada: boolean;
  recomendada?: boolean;
  rotuloRecomendado?: string;
  onEscolher: () => void;
};

/** Uma das tres opcoes grandes da pergunta de objetivo, role="radio" (ObjetivoFluxo). */
export function OpcaoObjetivo({ titulo, ajuda, marcada, recomendada = false, rotuloRecomendado, onEscolher }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={onEscolher}
      className={[styles.opcao, marcada ? styles.marcada : ""].filter(Boolean).join(" ")}
    >
      <span className={styles.textos}>
        {recomendada && rotuloRecomendado ? <span className={styles.recomendado}>{rotuloRecomendado}</span> : null}
        <span className={styles.titulo}>{titulo}</span>
        <span className={styles.ajuda}>{ajuda}</span>
      </span>
      <span className={[styles.check, marcada ? styles.checkVisivel : ""].filter(Boolean).join(" ")} aria-hidden="true">
        <Check size={24} strokeWidth={1.5} />
      </span>
    </button>
  );
}
