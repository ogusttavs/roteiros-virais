"use client";

import { useEffect } from "react";

import { avisarRedeVoltou } from "@/lib/estado-de-rede";

/** De quanto em quanto tempo confere se a rede voltou. */
const INTERVALO_SONDA_MS = 5000;

/**
 * Enquanto a tela acha que esta sem conexao (`ativa`) mas o navegador diz que
 * tem rede (sinal fraco, portal de wifi, pagina servida do guardado, um pedido
 * que caiu), confere `/api/saude` de tempos em tempos e chama `aoVoltar` quando
 * responde (V7, item 8 do PROXIMO.md). Sem esta conferencia o aviso so sumiria
 * quando uma acao desse certo, e as acoes que precisam de rede estariam
 * desabilitadas: a tela ficaria presa. Com `navigator.onLine` falso nao
 * confere: o navegador avisa sozinho quando a rede volta (evento `online`).
 */
export function useSondaDeRede(ativa: boolean, aoVoltar: () => void): void {
  useEffect(() => {
    if (!ativa || !navigator.onLine) return;
    let cancelado = false;
    const id = setInterval(async () => {
      try {
        const resposta = await fetch("/api/saude", { cache: "no-store" });
        if (cancelado || !resposta.ok) return;
        avisarRedeVoltou();
        aoVoltar();
      } catch {
        // Continua sem rede; confere de novo no proximo intervalo.
      }
    }, INTERVALO_SONDA_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [ativa, aoVoltar]);
}
