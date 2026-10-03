"use client";

import { useCallback, useRef, type CSSProperties, type PointerEvent as PointerEventReact, type RefObject } from "react";

/** Passa de 30% da altura da folha: fecha ao soltar (passo 16, capítulo 4). */
const FRACAO_PARA_FECHAR = 0.3;
/** Descida menor que essa, mas rápida (pixels por milissegundo), também fecha: o gesto de "jogar" a folha. */
const DISTANCIA_MINIMA_RAPIDA_PX = 30;
const VELOCIDADE_PARA_FECHAR = 0.5;
/** Puxar para cima resiste: a folha anda só um terço do dedo e volta (passo 16). */
const RESISTENCIA_PARA_CIMA = 1 / 3;

type ArrastoDaAlca = {
  onPointerDown: (evento: PointerEventReact<HTMLElement>) => void;
  onPointerMove: (evento: PointerEventReact<HTMLElement>) => void;
  onPointerUp: (evento: PointerEventReact<HTMLElement>) => void;
  onPointerCancel: (evento: PointerEventReact<HTMLElement>) => void;
  style: CSSProperties;
};

/**
 * Arrastar a alça da folha para baixo fecha (V7, item 1 do PROXIMO.md: "toque
 * fora, arrastar, Esc e o botão voltar fecham a folha"). A folha acompanha o dedo
 * por uma variável (`--arrasto`, lida pelo CSS da folha e pelo `folha-desce`, para
 * a saída continuar de onde o dedo largou), o véu clareia junto, puxar para cima
 * resiste e soltar sem fechar volta na mola (passo 16 do Opus, capítulo 4).
 *
 * Uso: `const arrasto = usePuxarParaFechar(fechar);` e então
 * `ref={arrasto.folhaRef}` na folha inteira (é ela que acompanha o dedo) e
 * `{...arrasto.alca}` no cabeçalho dela (alça e título). O véu é o irmão
 * anterior da folha com `data-veu`. O `touch-action: none` vale só nesse
 * trecho; o corpo da folha continua rolando normalmente.
 *
 * Solta antes do limite: a folha volta. Solta depois: chama `fechar` (que
 * deve ser o `fechar` de `useFolhaNoHistorico`); se a folha não fechar (por
 * exemplo, uma reescrita em andamento), ela volta ao lugar.
 */
export function usePuxarParaFechar(fechar: () => void): {
  folhaRef: RefObject<HTMLDivElement | null>;
  alca: ArrastoDaAlca;
} {
  const folhaRef = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ y: number; t: number } | null>(null);

  function veuDaFolha(): HTMLElement | null {
    const irmao = folhaRef.current?.previousElementSibling;
    return irmao instanceof HTMLElement && irmao.hasAttribute("data-veu") ? irmao : null;
  }

  const aoIniciar = useCallback((evento: PointerEventReact<HTMLElement>) => {
    if (evento.pointerType === "mouse" && evento.button !== 0) return;
    inicio.current = { y: evento.clientY, t: evento.timeStamp };
    evento.currentTarget.setPointerCapture(evento.pointerId);
    if (folhaRef.current) folhaRef.current.style.transition = "none";
  }, []);

  const aoMover = useCallback((evento: PointerEventReact<HTMLElement>) => {
    if (!inicio.current || !folhaRef.current) return;
    const dedo = evento.clientY - inicio.current.y;
    const deslocamento = dedo >= 0 ? dedo : dedo * RESISTENCIA_PARA_CIMA;
    const folha = folhaRef.current;
    folha.style.setProperty("--arrasto", `${deslocamento}px`);
    const veu = veuDaFolha();
    if (veu) veu.style.opacity = String(Math.max(0, 1 - Math.max(0, deslocamento) / Math.max(1, folha.offsetHeight)));
     
  }, []);

  const terminar = useCallback(
    (evento: PointerEventReact<HTMLElement>, cancelado: boolean) => {
      const comeco = inicio.current;
      inicio.current = null;
      const folha = folhaRef.current;
      if (!comeco || !folha) return;
      const desceu = evento.clientY - comeco.y;
      const velocidade = desceu / Math.max(1, evento.timeStamp - comeco.t);
      const fecha =
        !cancelado &&
        (desceu > folha.offsetHeight * FRACAO_PARA_FECHAR || (desceu > DISTANCIA_MINIMA_RAPIDA_PX && velocidade > VELOCIDADE_PARA_FECHAR));
      const veu = veuDaFolha();
      if (fecha) {
        // A saída (`folha-desce`) parte de `--arrasto` e o véu volta ao controle do CSS (`veu-some`).
        folha.style.transition = "none";
        if (veu) veu.style.opacity = "";
        fechar();
        // Se a folha continuar montada (fechar recusado), volta ao lugar com a mola.
        setTimeout(() => {
          if (folhaRef.current && !folhaRef.current.hasAttribute("data-saindo")) {
            folhaRef.current.style.transition = "transform var(--duracao-soltar) var(--curva-mola)";
            folhaRef.current.style.setProperty("--arrasto", "0px");
          }
        }, 400);
        return;
      }
      folha.style.transition = "transform var(--duracao-soltar) var(--curva-mola)";
      folha.style.setProperty("--arrasto", "0px");
      if (veu) {
        veu.style.transition = "opacity var(--duracao-soltar) var(--curva-padrao)";
        veu.style.opacity = "";
      }
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
