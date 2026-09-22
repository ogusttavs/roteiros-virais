"use client";

import { useCallback, useRef, type CSSProperties, type PointerEvent as PointerEventReact, type RefObject } from "react";

/** Quanto o dedo precisa descer, em pixels, para a folha fechar ao soltar. */
const DISTANCIA_PARA_FECHAR_PX = 80;
/** Descida menor que a de cima, mas rápida (pixels por milissegundo), também fecha: o gesto de "jogar" a folha. */
const DISTANCIA_MINIMA_RAPIDA_PX = 30;
const VELOCIDADE_PARA_FECHAR = 0.5;

type ArrastoDaAlca = {
  onPointerDown: (evento: PointerEventReact<HTMLElement>) => void;
  onPointerMove: (evento: PointerEventReact<HTMLElement>) => void;
  onPointerUp: (evento: PointerEventReact<HTMLElement>) => void;
  onPointerCancel: (evento: PointerEventReact<HTMLElement>) => void;
  style: CSSProperties;
};

/**
 * Arrastar a alça da folha para baixo fecha (V7, item 1 do PROXIMO.md: "toque
 * fora, arrastar, Esc e o botão voltar fecham a folha"). O desenho já mostra a
 * alça; sem isto o gesto que ela convida não fazia nada e, no Chrome do
 * Android, o arrasto virava "puxar para recarregar" a página de trás.
 *
 * Uso: `const arrasto = usePuxarParaFechar(fechar);` e então
 * `ref={arrasto.folhaRef}` na folha inteira (é ela que acompanha o dedo) e
 * `{...arrasto.alca}` no cabeçalho dela (alça e título). O `touch-action: none`
 * vale só nesse trecho; o corpo da folha continua rolando normalmente.
 *
 * Solta antes do limite: a folha volta. Solta depois: chama `fechar` (que
 * deve ser o `fechar` de `useFolhaNoHistorico`); se a folha não fechar (por
 * exemplo, uma reescrita em andamento), ela volta ao lugar depois da
 * transição.
 */
export function usePuxarParaFechar(fechar: () => void): {
  folhaRef: RefObject<HTMLDivElement | null>;
  alca: ArrastoDaAlca;
} {
  const folhaRef = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ y: number; t: number } | null>(null);

  const aoIniciar = useCallback((evento: PointerEventReact<HTMLElement>) => {
    if (evento.pointerType === "mouse" && evento.button !== 0) return;
    inicio.current = { y: evento.clientY, t: evento.timeStamp };
    evento.currentTarget.setPointerCapture(evento.pointerId);
    if (folhaRef.current) folhaRef.current.style.transition = "none";
  }, []);

  const aoMover = useCallback((evento: PointerEventReact<HTMLElement>) => {
    if (!inicio.current || !folhaRef.current) return;
    const desceu = Math.max(0, evento.clientY - inicio.current.y);
    folhaRef.current.style.transform = `translateY(${desceu}px)`;
  }, []);

  const terminar = useCallback(
    (evento: PointerEventReact<HTMLElement>, cancelado: boolean) => {
      const comeco = inicio.current;
      inicio.current = null;
      const folha = folhaRef.current;
      if (!comeco || !folha) return;
      const desceu = evento.clientY - comeco.y;
      const velocidade = desceu / Math.max(1, evento.timeStamp - comeco.t);
      folha.style.transition = "transform var(--duracao-base) var(--curva-saida)";
      const fecha =
        !cancelado &&
        (desceu > DISTANCIA_PARA_FECHAR_PX ||
          (desceu > DISTANCIA_MINIMA_RAPIDA_PX && velocidade > VELOCIDADE_PARA_FECHAR));
      if (!fecha) {
        folha.style.transform = "";
        return;
      }
      fechar();
      // Se a folha continuar montada (fechar recusado), volta ao lugar; se saiu, a referência já é nula.
      setTimeout(() => {
        if (folhaRef.current) folhaRef.current.style.transform = "";
      }, 300);
    },
    [fechar],
  );

  return {
    folhaRef,
    alca: {
      onPointerDown: aoIniciar,
      onPointerMove: aoMover,
      onPointerUp: (evento) => terminar(evento, false),
      onPointerCancel: (evento) => terminar(evento, true),
      style: { touchAction: "none" },
    },
  };
}
