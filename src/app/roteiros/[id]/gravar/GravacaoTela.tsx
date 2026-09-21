"use client";

import { Check, ChevronLeft, Eye, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { marcarGravadoAction } from "@/app/(painel)/(completo)/roteiros/[id]/acoes";
import { iniciaisDe } from "@/lib/iniciais";
import { textosConexao } from "@/textos/conexao";
import { textosGravacao } from "@/textos/gravacao";
import { Toast } from "@/ui/componentes/Toast";
import { useSemRede } from "@/ui/useSemRede";

import styles from "./GravacaoTela.module.css";

type Bloco = { rotulo: string; paragrafos: string[] };

type Props = {
  roteiroId: number;
  titulo: string;
  blocos: Bloco[];
  /** Se o roteiro já estava marcado como gravado ao entrar (revisão do PR #31, item 6). */
  jaGravado: boolean;
  /**
   * Nome da marca ativa, só com mais de uma marca (V3, item 3,
   * Gravacao.dc.html): em linha pequena no topo, sem ação, só para
   * confirmar para qual marca se está gravando.
   */
  nomeMarca?: string;
};

/**
 * Modo gravação como tela própria, sem navegação (design v2,
 * `entrega/telas/Gravacao.dc.html`; `PROXIMO.md`, D2 parte 1, item 7):
 * substitui o modo gravação que era um estado sobreposto de `/roteiros/[id]`.
 */
export function GravacaoTela({ roteiroId, titulo, blocos, jaGravado, nomeMarca }: Props) {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [temWakeLock, setTemWakeLock] = useState(false);
  const [gravado, setGravado] = useState(jaGravado);
  const [marcando, setMarcando] = useState(false);
  const semRede = useSemRede();
  const [erroToast, setErroToast] = useState(false);

  /**
   * O navegador solta o wake lock sozinho quando a aba fica escondida (a
   * pessoa troca para a câmera para gravar); pedir de novo ao voltar
   * visível, e esconder o aviso enquanto não tiver (revisão do PR #31,
   * item 5: nunca mentir que a tela vai ficar acesa).
   */
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinela: WakeLockSentinel | null = null;
    let cancelado = false;

    async function pedir() {
      if (document.visibilityState !== "visible") return;
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelado) {
          s.release();
          return;
        }
        sentinela = s;
        setTemWakeLock(true);
        s.addEventListener("release", () => setTemWakeLock(false));
      } catch {
        setTemWakeLock(false);
      }
    }

    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") pedir();
    }

    pedir();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      sentinela?.release();
    };
  }, []);

  const bloco = blocos[passo];
  const proximo = blocos[passo + 1] ?? null;
  const primeiroParagrafoProximo = proximo?.paragrafos[0] ?? null;

  function marcarGravado() {
    if (gravado || marcando) return;
    setMarcando(true);
    marcarGravadoAction(roteiroId)
      .then(() => setGravado(true))
      .catch(() => setErroToast(true))
      .finally(() => setMarcando(false));
  }

  return (
    <div className={styles.gravacao}>
      <header className={nomeMarca ? `${styles.topo} ${styles.comMarca}` : styles.topo}>
        {nomeMarca ? (
          <p className={styles.marcaGravando}>
            <span className={styles.avatar} aria-hidden="true">
              {iniciaisDe(nomeMarca)}
            </span>
            <span>{nomeMarca}</span>
          </p>
        ) : null}
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
          aria-label={gravado ? textosGravacao.gravado : textosGravacao.marcarGravei}
          aria-pressed={gravado}
          className={`${styles.redondo} ${gravado ? styles.redondoFeito : ""}`}
          disabled={marcando || semRede}
          onClick={marcarGravado}
        >
          <Check size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {semRede ? <p>{textosConexao.precisaDeConexao}</p> : null}
      <Toast texto={textosGravacao.erroMarcar} aberto={erroToast} onFechar={() => setErroToast(false)} />
    </div>
  );
}
