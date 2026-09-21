"use client";

import { useEffect, useState } from "react";

/**
 * A altura que o teclado precisa tirar do `visualViewport` para contar como
 * "aberto" (V7, item 0c): mais que a variação normal da barra de endereço
 * do celular ao rolar, bem menos que a altura de um teclado de verdade.
 */
const LIMIAR_TECLADO_PX = 150;

/**
 * O teclado virtual do celular está aberto: o `visualViewport` fica bem
 * menor que a janela inteira (V7, item 0c, achado do PR #50: a cápsula das
 * abas ficava por cima do conteúdo com o teclado aberto). `false` em
 * qualquer aparelho sem `visualViewport` (não é um recurso novo, mas por
 * segurança) e sempre `false` no servidor.
 */
export function useTecladoAberto(): boolean {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function aoRedimensionar() {
      setAberto(window.innerHeight - vv!.height > LIMIAR_TECLADO_PX);
    }

    vv.addEventListener("resize", aoRedimensionar);
    aoRedimensionar();
    return () => vv.removeEventListener("resize", aoRedimensionar);
  }, []);

  return aberto;
}
