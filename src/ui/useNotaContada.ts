"use client";

import { useLayoutEffect, useRef, useState } from "react";

const DURACAO_MS = 600;

/**
 * Passo 16 do Opus, capítulo 5 e dúvida 6 (aceita): a nota do briefing conta de zero até o valor em 600 ms, UMA vez, na primeira vez que ela aparece com valor.
 * Depois disso, uma nota que muda (a reavaliação) troca direto. Sem animação em "reduzir movimento" e onde não há `matchMedia` (os testes): mostra o valor na hora.
 */
export function useNotaContada(valor: number): number {
  const [mostrada, setMostrada] = useState(valor);
  const jaContou = useRef(false);

  // `useLayoutEffect`: o zero entra antes da primeira pintura, em vez de um quadro com o valor final e depois o zero (o servidor e a hidratação mostram o valor).
  useLayoutEffect(() => {
    if (jaContou.current) {
      setMostrada(valor);
      return;
    }
    if (valor <= 0) {
      setMostrada(valor);
      return;
    }
    jaContou.current = true;
    if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMostrada(valor);
      return;
    }
    let quadro = 0;
    const inicio = performance.now();
    setMostrada(0);
    function passo(agora: number) {
      const t = Math.min(1, (agora - inicio) / DURACAO_MS);
      // sai rápido e assenta (curva de saída)
      setMostrada(valor * (1 - Math.pow(1 - t, 3)));
      if (t < 1) quadro = requestAnimationFrame(passo);
    }
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor]);

  return mostrada;
}
