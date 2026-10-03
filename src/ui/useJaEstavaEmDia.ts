"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Passo 16 do Opus, capítulo 5: o conteúdo velho fica à vista até o novo chegar (nunca esvazia, nunca esqueleto por cima). Quando a atualização termina e o texto
 * da tela é o mesmo de antes, o botão "Atualizar" diz "Já estava em dia" por 2 segundos e volta. Quem tem o botão passa se está atualizando; o gancho guarda o
 * texto do `<main>` quando a atualização começa e o compara quando ela acaba.
 */
export function useJaEstavaEmDia(atualizando: boolean): boolean {
  const [emDia, setEmDia] = useState(false);
  const antes = useRef<string | null>(null);

  useEffect(() => {
    if (atualizando) {
      antes.current = document.querySelector("main")?.textContent ?? "";
      return;
    }
    if (antes.current === null) return;
    const depois = document.querySelector("main")?.textContent ?? "";
    const igual = antes.current === depois;
    antes.current = null;
    if (!igual) return;
    setEmDia(true);
    const volta = setTimeout(() => setEmDia(false), 2000);
    return () => clearTimeout(volta);
  }, [atualizando]);

  return emDia && !atualizando;
}
