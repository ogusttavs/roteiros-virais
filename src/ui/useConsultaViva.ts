"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** De quanto em quanto tempo a tela pergunta enquanto algo está sendo escrito, com a aba visível (R-j). */
export const INTERVALO_DA_CONSULTA_MS = 5000;
/** Sem rede, a pergunta espera mais (R-j); o pedido não muda de estado por isso (R-a). */
export const INTERVALO_SEM_REDE_MS = 15_000;

type Opcoes = { intervaloMs?: number; intervaloSemRedeMs?: number; jaNaEntrada?: boolean };

/**
 * E74 PR 2a: pergunta ao servidor de tempos em tempos enquanto `ativo`, e só com a aba visível (R-j): com a aba escondida (a tela bloqueada, outro app) nada sai, e a volta (`visibilitychange`
 * para visível, `pageshow` da página guardada pelo navegador) pergunta na hora (R-i). `consultar` lança quando a rede falhou: a próxima pergunta espera mais e `semRede` fica verdadeiro, sem
 * mudar nada do pedido. Uma pergunta por vez: a seguinte só sai depois de a anterior voltar.
 */
export function useConsultaViva(ativo: boolean, consultar: () => Promise<void>, opcoes: Opcoes = {}): { semRede: boolean; consultarAgora: () => void } {
  const { intervaloMs = INTERVALO_DA_CONSULTA_MS, intervaloSemRedeMs = INTERVALO_SEM_REDE_MS, jaNaEntrada = false } = opcoes;
  const [semRede, setSemRede] = useState(false);
  const consultarRef = useRef(consultar);
  useEffect(() => {
    consultarRef.current = consultar;
  });
  /** Pergunta já, sem esperar a próxima batida (a tela que acabou de perder a resposta da escrita, R-a). Sem efeito com `ativo` falso ou a aba escondida. */
  const agoraRef = useRef<() => void>(() => undefined);
  const consultarAgora = useCallback(() => agoraRef.current(), []);

  useEffect(() => {
    if (!ativo) {
      setSemRede(false);
      return;
    }
    let parou = false;
    let emCurso = false;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const visivel = () => typeof document === "undefined" || document.visibilityState === "visible";

    async function bater() {
      if (parou || emCurso) return;
      // Escondida: para de perguntar até a aba voltar (quem acorda é o `voltou`, abaixo).
      if (!visivel()) return;
      emCurso = true;
      let espera = intervaloMs;
      try {
        await consultarRef.current();
        if (!parou) setSemRede(false);
      } catch {
        espera = intervaloSemRedeMs;
        if (!parou) setSemRede(true);
      } finally {
        emCurso = false;
      }
      if (parou) return;
      clearTimeout(relogio);
      relogio = setTimeout(() => void bater(), espera);
    }

    function voltou() {
      if (parou || !visivel()) return;
      clearTimeout(relogio);
      void bater();
    }

    agoraRef.current = voltou;
    relogio = setTimeout(() => void bater(), jaNaEntrada ? 0 : intervaloMs);
    document.addEventListener("visibilitychange", voltou);
    window.addEventListener("pageshow", voltou);
    return () => {
      parou = true;
      agoraRef.current = () => undefined;
      clearTimeout(relogio);
      document.removeEventListener("visibilitychange", voltou);
      window.removeEventListener("pageshow", voltou);
    };
  }, [ativo, intervaloMs, intervaloSemRedeMs, jaNaEntrada]);

  return { semRede, consultarAgora };
}
