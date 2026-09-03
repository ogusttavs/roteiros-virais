"use client";

import { Bookmark } from "lucide-react";

import styles from "./ReferenciaCartao.module.css";
import type { VideoEmbedProps } from "./VideoEmbed";
import { VideoEmbed } from "./VideoEmbed";

export type AnaliseLinha = { rotulo: string; texto: string };

type Props = {
  /** Ja formatado ("6,2x"). */
  vezes: string;
  /** Ja formatado ("acima do normal da conta"). */
  rotuloVezes: string;
  conta: string;
  data: string;
  analise: AnaliseLinha[];
  embed: VideoEmbedProps;
  salvo: boolean;
  rotuloUsar: string;
  rotuloSalvar: string;
  onSalvar: () => void;
  onUsar: () => void;
};

/** Um vídeo da biblioteca de referências, com a analise e as duas ações (ReferenciasTela). */
export function ReferenciaCartao({
  vezes,
  rotuloVezes,
  conta,
  data,
  analise,
  embed,
  salvo,
  rotuloUsar,
  rotuloSalvar,
  onSalvar,
  onUsar,
}: Props) {
  return (
    <article className={styles.cartao}>
      <div className={styles.cabecalho}>
        <span className={styles.vezes}>{vezes}</span>
        <span className={styles.rotuloVezes}>{rotuloVezes}</span>
      </div>
      <VideoEmbed {...embed} />
      <span className={styles.contaData}>
        {conta} · {data}
      </span>
      <div className={styles.analise}>
        {analise.map((linha) => (
          <div key={linha.rotulo} className={styles.linhaAnalise}>
            <span className={styles.rotuloAnalise}>{linha.rotulo}</span>
            <p className={styles.textoAnalise}>{linha.texto}</p>
          </div>
        ))}
      </div>
      <div className={styles.rodape}>
        <button type="button" className={styles.usar} onClick={onUsar}>
          {rotuloUsar}
        </button>
        <button
          type="button"
          aria-pressed={salvo}
          aria-label={rotuloSalvar}
          onClick={onSalvar}
          className={styles.salvar}
        >
          <Bookmark size={24} strokeWidth={1.5} fill={salvo ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
