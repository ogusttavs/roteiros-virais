"use client";

import { useEffect, useState } from "react";

/**
 * Mantém a tela acesa enquanto a pessoa grava (o mesmo cuidado do modo gravação de sempre): o navegador solta o wake lock sozinho quando a aba fica escondida (a pessoa troca para a câmera),
 * então pede de novo ao voltar visível, e só diz que a tela fica acesa enquanto tiver de fato. Devolve `true` com o wake lock ativo.
 */
export function useTelaAcesa(): boolean {
  const [temWakeLock, setTemWakeLock] = useState(false);
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
  return temWakeLock;
}
