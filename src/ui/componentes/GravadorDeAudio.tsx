"use client";

import { Mic, Square } from "lucide-react";

import { Botao } from "./Botao";
import styles from "./GravadorDeAudio.module.css";
import type { FaseGravador } from "./useGravadorDeAudio";

/**
 * P2, item 1: a parte visual do gravador (o botão redondo, "gravando Ns"), separada do gancho
 * `useGravadorDeAudio`. Usada por `FolhaGravarAgora` e `FolhaPlanejarDias`, sem mudar a aparência
 * de nenhuma das duas. O erro (`erro` do gancho) fica fora de propósito: cada tela já mostra a
 * mensagem do jeito dela (a do momento, dentro do bloco; a de planejar, junto do erro da agenda).
 */
type Props = {
  fase: FaseGravador;
  segundos: number;
  onIniciar: () => void;
  onParar: () => void;
  rotuloGravar: string;
  rotuloParar: string;
  rotuloTranscrevendo: string;
  formatarGravando: (segundos: number) => string;
};

export function GravadorDeAudio({ fase, segundos, onIniciar, onParar, rotuloGravar, rotuloParar, rotuloTranscrevendo, formatarGravando }: Props) {
  return (
    <div className={styles.blocoAudio}>
      {fase === "gravando" ? (
        <Botao variante="secundario" tamanho="lg" onClick={onParar}>
          <Square size={18} strokeWidth={1.75} aria-hidden="true" />
          {rotuloParar}
        </Botao>
      ) : (
        <Botao
          variante="secundario"
          tamanho="lg"
          precisaDeRede
          disabled={fase === "transcrevendo"}
          carregando={fase === "transcrevendo"}
          onClick={onIniciar}
        >
          <Mic size={18} strokeWidth={1.75} aria-hidden="true" />
          {fase === "transcrevendo" ? rotuloTranscrevendo : rotuloGravar}
        </Botao>
      )}
      {fase === "gravando" ? (
        <span className={[styles.status, styles.gravando].join(" ")} aria-live="polite">
          {formatarGravando(segundos)}
        </span>
      ) : null}
    </div>
  );
}
