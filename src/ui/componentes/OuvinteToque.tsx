"use client";

import { useEffect } from "react";

/**
 * O iPhone só liga o `:active` do CSS quando a página tem um ouvinte de toque (passo 16 do Opus, capítulo 6): sem isto, o aperto de botão, cartão e pílula não
 * aparece no Safari. Um ouvinte vazio e passivo no corpo basta; o aperto se cancela sozinho quando o dedo anda (o navegador entende rolagem).
 */
export function OuvinteToque() {
  useEffect(() => {
    const nada = () => {};
    document.body.addEventListener("touchstart", nada, { passive: true });
    return () => document.body.removeEventListener("touchstart", nada);
  }, []);
  return null;
}
