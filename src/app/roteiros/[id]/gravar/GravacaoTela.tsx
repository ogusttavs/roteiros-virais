"use client";

import { Check, ChevronLeft, Eye, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { marcarGravadoAction } from "@/app/(painel)/(completo)/roteiros/[id]/acoes";
import { textosGravacao } from "@/textos/gravacao";

import styles from "./GravacaoTela.module.css";

type Bloco = { rotulo: string; paragrafos: string[] };

type Props = {
  roteiroId: number;
  titulo: string;
  blocos: Bloco[];
};

/**
 * Modo gravação como tela própria, sem navegação (design v2,
 * `entrega/telas/Gravacao.dc.html`; `PROXIMO.md`, D2 parte 1, item 7):
 * substitui o modo gravação que era um estado sobreposto de `/roteiros/[id]`.
 */
export function GravacaoTela({ roteiroId, titulo, blocos }: Props) {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [temWakeLock, setTemWakeLock] = useState(false);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinela: WakeLockSentinel | null = null;
    let cancelado = false;
    navigator.wakeLock
      .request("screen")
      .then((s) => {
        if (cancelado) {
          s.release();
          return;
        }
        sentinela = s;
        setTemWakeLock(true);
      })
      .catch(() => setTemWakeLock(false));
    return () => {
      cancelado = true;
      sentinela?.release();
    };
  }, []);

  const bloco = blocos[passo];
  const proximo = blocos[passo + 1] ?? null;
  const primeiroParagrafoProximo = proximo?.paragrafos[0] ?? null;

  function marcarGravado() {
    marcarGravadoAction(roteiroId).catch(() => undefined);
  }

  return (
    <div className={styles.gravacao}>
      <header className={styles.topo}>
        <button
          type="button"
          aria-label={textosGravacao.sair}
          className={styles.botaoSair}
          onClick={() => router.push(`/roteiros/${roteiroId}`)}
        >
          <X size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className={styles.passos} role="group" aria-label={titulo}>
          {blocos.map((_, indice) => (
            <span
              key={indice}
              className={[styles.passo, indice < passo ? styles.feito : "", indice === passo ? styles.atual : ""]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
        <span className={styles.contagem}>{textosGravacao.contagem(passo + 1, blocos.length)}</span>
      </header>

      <main className={styles.palco}>
        <div className={styles.palcoCentro}>
          <span className={styles.blocoTempo}>{bloco.rotulo}</span>
          {bloco.paragrafos.map((paragrafo, indice) => (
            <p key={indice} className={styles.fala}>
              {paragrafo}
            </p>
          ))}
          {primeiroParagrafoProximo ? (
            <div className={styles.proximo}>
              <span className={styles.rotuloProximo}>{textosGravacao.depoisVem}</span>
              <p className={styles.falaProxima}>{primeiroParagrafoProximo}</p>
            </div>
          ) : null}
          {temWakeLock ? (
            <p className={styles.avisoTela}>
              <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
              {textosGravacao.telaAcesa}
            </p>
          ) : null}
        </div>
      </main>

      <div className={styles.controles}>
        <button
          type="button"
          aria-label={textosGravacao.blocoAnterior}
          className={styles.redondo}
          disabled={passo === 0}
          onClick={() => setPasso((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={passo === blocos.length - 1}
          onClick={() => setPasso((p) => Math.min(blocos.length - 1, p + 1))}
        >
          {textosGravacao.proximoBloco}
        </button>
        <button
          type="button"
          aria-label={textosGravacao.marcarGravei}
          className={styles.redondo}
          onClick={marcarGravado}
        >
          <Check size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
