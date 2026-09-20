"use client";

import { useEffect, useRef, useState } from "react";

/**
 * O sentido da rolagem, para esconder ou encolher o que flutua por cima do
 * conteúdo: `true` ao descer, `false` ao subir ou perto do topo. Uma folga
 * de 4 px (não reage a um tremor mínimo) e um piso de 60 px para "descer"
 * (perto do topo sempre mostra inteiro), com o topo de verdade (20 px)
 * sempre voltando ao estado aberto.
 *
 * V5, item 5: extraído de `CabecalhoCelular.tsx` (que já usava exatamente
 * este padrão para esconder ao rolar) para a cápsula das abas encolher do
 * mesmo jeito, sem duplicar o `useEffect`.
 */
export function useRolagemParaBaixo(): boolean {
  const [paraBaixo, setParaBaixo] = useState(false);
  const ultimoRef = useRef(0);

  useEffect(() => {
    function aoRolar() {
      const y = window.scrollY;
      const ultimo = ultimoRef.current;
      const desce = y > ultimo + 4 && y > 60;
      const sobe = y < ultimo - 4 || y < 20;
      if (desce) setParaBaixo(true);
      else if (sobe) setParaBaixo(false);
      ultimoRef.current = y;
    }
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  return paraBaixo;
}
