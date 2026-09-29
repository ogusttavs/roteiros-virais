"use client";

import { useEffect } from "react";

/** 100ms: tempo para um segundo campo ganhar o foco (trocar de campo com Tab, por exemplo) antes de recalcular. */
const ESPERA_MS = 100;

function campoEditavelEmFoco(): boolean {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLElement)) return false;
  return ativo.tagName === "INPUT" || ativo.tagName === "TEXTAREA" || Boolean(ativo.isContentEditable);
}

/**
 * H3, item 3: a `BarraAcao` (fixa no pé do celular) apareceu flutuando a
 * meio da tela no iPhone em modo aplicativo, depois de fechar o teclado.
 * Hipótese do Fable, a confirmar: o iPhone em modo aplicativo não devolve a
 * área visível ao tamanho inteiro só porque o teclado fechou, só na próxima
 * rolagem de verdade, e o que é `position: fixed` no pé fica onde o topo do
 * teclado estava. Uma das duas defesas (a outra é a `BarraAcao` deixar de
 * ser fixa em `/comecar`): 100ms depois de um campo perder o foco, sem outro
 * ganhar o foco no meio (trocar de campo não conta), força o navegador a
 * recalcular o layout com um `scrollTo` para a própria posição.
 */
export function useRecalcularAoFecharTeclado() {
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | null = null;

    function aoPerderFoco() {
      // Limpa um temporizador pendente antes de agendar outro (achado escrevendo o teste: um
      // `focusout` que dispara mais de uma vez em sequência perdia o id do primeiro, que sobrevivia
      // e recalculava sozinho mais tarde, mesmo com um campo novo já em foco havia muito tempo).
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        temporizador = null;
        if (campoEditavelEmFoco()) return;
        requestAnimationFrame(() => {
          window.scrollTo(window.scrollX, window.scrollY);
        });
      }, ESPERA_MS);
    }

    function aoGanharFoco() {
      if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
      }
    }

    document.addEventListener("focusout", aoPerderFoco);
    document.addEventListener("focusin", aoGanharFoco);
    return () => {
      document.removeEventListener("focusout", aoPerderFoco);
      document.removeEventListener("focusin", aoGanharFoco);
      if (temporizador) clearTimeout(temporizador);
    };
  }, []);
}
