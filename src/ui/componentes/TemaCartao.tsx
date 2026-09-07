"use client";

import { Check } from "lucide-react";

import { textosHoje } from "@/textos/hoje";

import styles from "./TemaCartao.module.css";

export type EvidenciaTema = {
  conta: string | null;
  multiplo: string;
  /** "acima do normal dessa conta" / "na média dessa conta" / "abaixo do normal dessa conta" (`rotuloMultiploConta`). */
  rotulo: string;
  views: string;
  /** "hoje" / "ontem" / "em N dias" (`fraseDiasAtras`); nunca "em 0 dias". */
  quando: string;
  parecidos: number;
};

type Props = {
  /** Ex.: "para te chamarem". */
  rotulo: string;
  tema: string;
  porque: string;
  /** `null` quando não há vídeo de evidência: o bloco não aparece (`BRIEF.md`, sem número inventado). */
  evidencia: EvidenciaTema | null;
  /** O tema recomendado do dia: marca e botão preenchido em vez de linha (design v2, Hoje.Normal). */
  primario?: boolean;
  rotuloBotao: string;
  onEscolher: () => void;
};

/** Um tema do dia, com evidência e o rótulo de objetivo (design v2, `entrega/telas/Hoje.dc.html`, `.tema`). */
export function TemaCartao({ rotulo, tema, porque, evidencia, primario = false, rotuloBotao, onEscolher }: Props) {
  return (
    <article className={[styles.cartao, primario ? styles.primario : ""].filter(Boolean).join(" ")}>
      {primario ? (
        <span className={styles.marcaRecomendado}>
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          {textosHoje.maisIndicadoParaHoje}
        </span>
      ) : null}
      <div className={styles.tituloArea}>
        <span className={styles.rotulo}>{rotulo}</span>
        <h3 className={styles.tema}>{tema}</h3>
      </div>
      <p className={styles.porque}>{porque}</p>
      {evidencia ? (
        <div className={styles.evidencia}>
          {evidencia.conta ? (
            <span className={styles.evidenciaLinha}>
              <span className={styles.conta}>{evidencia.conta}</span>
            </span>
          ) : null}
          <span className={styles.evidenciaLinha}>
            <b>{evidencia.multiplo}</b> {textosHoje.evidenciaMultiplo(evidencia.rotulo, evidencia.views, evidencia.quando)}
          </span>
          {evidencia.parecidos > 0 ? (
            <span className={styles.evidenciaLinha}>{textosHoje.evidenciaParecidos(evidencia.parecidos)}</span>
          ) : null}
        </div>
      ) : null}
      <div className={styles.rodape}>
        <button
          type="button"
          onClick={onEscolher}
          className={[styles.botao, primario ? styles.botaoPrimario : styles.botaoSecundario].join(" ")}
        >
          {rotuloBotao}
        </button>
      </div>
    </article>
  );
}
