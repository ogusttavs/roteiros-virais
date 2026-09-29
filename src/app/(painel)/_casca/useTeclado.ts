"use client";

import { useEffect, useState } from "react";

/**
 * A altura que o teclado precisa tirar do `visualViewport` para contar como
 * "aberto" (V7, item 0c): mais que a variação normal da barra de endereço
 * do celular ao rolar, bem menos que a altura de um teclado de verdade.
 */
const LIMIAR_TECLADO_PX = 150;

/**
 * Acima disso a pessoa está com zoom de pinça (V7, item 2 do PROXIMO.md): o
 * `visualViewport` também encolhe (altura da janela dividida pela escala), e
 * sem esta conferência a cápsula das abas sumia sem teclado nenhum.
 */
const ESCALA_SEM_ZOOM = 1.01;

/**
 * Um campo de texto de verdade está com o foco: `input`, `textarea` ou
 * qualquer coisa `contenteditable` (H3, item 2). Sem isto, o iPhone em modo
 * aplicativo podia deixar a diferença de altura acima do limiar mesmo sem
 * teclado nenhum aberto (ou depois de fechado), e a cápsula das abas sumia
 * para sempre.
 */
function campoEditavelEmFoco(): boolean {
  const ativo = document.activeElement;
  if (!ativo) return false;
  if (ativo.tagName === "INPUT" || ativo.tagName === "TEXTAREA") return true;
  // `Boolean(...)`, nunca só `ativo.isContentEditable`: sem elemento contenteditable nenhum na
  // página, `isContentEditable` pode vir `undefined` (achado testando esta rodada), e
  // `diferencaAcimaDoLimiar && undefined` vira `undefined`, não `false` (o hook teria que devolver
  // sempre `boolean`, e um valor `undefined` escapando confundia quem chama, `CapsulaAbas.tsx`).
  return ativo instanceof HTMLElement && Boolean(ativo.isContentEditable);
}

/**
 * O teclado virtual do celular está aberto: um campo de texto tem o foco E o
 * `visualViewport` fica bem menor que a janela inteira, as duas coisas (V7,
 * item 0c, achado do PR #50: a cápsula das abas ficava por cima do conteúdo
 * com o teclado aberto; H3, item 2, achado do Gustavo no iPhone em modo
 * aplicativo: só a diferença de altura, sem exigir foco, dava falso positivo
 * e a cápsula ficava escondida sem teclado nenhum, às vezes para sempre).
 * `false` em qualquer aparelho sem `visualViewport` (não é um recurso novo,
 * mas por segurança) e sempre `false` no servidor.
 */
export function useTecladoAberto(): boolean {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function recalcular() {
      const diferencaAcimaDoLimiar = vv!.scale <= ESCALA_SEM_ZOOM && window.innerHeight - vv!.height > LIMIAR_TECLADO_PX;
      setAberto(diferencaAcimaDoLimiar && campoEditavelEmFoco());
    }

    vv.addEventListener("resize", recalcular);
    document.addEventListener("focusin", recalcular);
    document.addEventListener("focusout", recalcular);
    recalcular();
    return () => {
      vv.removeEventListener("resize", recalcular);
      document.removeEventListener("focusin", recalcular);
      document.removeEventListener("focusout", recalcular);
    };
  }, []);

  return aberto;
}
