"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";

import styles from "./template.module.css";

/** A fundura de uma rota: `/hoje` e `/criar` são o primeiro nível (as abas), `/roteiros/12` e `/criar/temas` são telas dentro delas. */
function fundura(caminho: string): number {
  return caminho.split("/").filter(Boolean).length;
}

// O Voltar do aparelho (ou do navegador) dispara `popstate` antes da rota trocar: guarda isso para a tela que chega entrar pelo outro lado.
let foiVoltar = false;
let ultimoCaminho: string | null = null;
if (typeof window !== "undefined") {
  ultimoCaminho = window.location.pathname;
  // Fechar uma folha também faz `history.back()` (e dispara `popstate`) sem trocar de rota: só vale como "voltar" se o caminho mudou.
  window.addEventListener("popstate", () => {
    if (window.location.pathname !== ultimoCaminho) foiVoltar = true;
  });
}

type Sentido = "troca" | "entra" | "volta";

/**
 * Passo 16 do Opus, capítulo 3 (entre telas), na forma que o Next 15 deixa fazer sem biblioteca: a tela que chega anima na entrada; o cabeçalho e a cápsula ficam
 * fora deste elemento e não andam. Trocar de aba esmaece no lugar (180 ms); entrar num item (uma rota mais funda) desliza da direita com a mola suave (360 ms);
 * voltar (Voltar do aparelho, ou uma rota menos funda) desliza para o outro lado em 280 ms. Só `transform` e `opacity`, nunca `left`/`right`. A tela de baixo
 * recuar e escurecer (o desenho completo) pede a API de transição de view do navegador, que o roteador do Next 15 ainda não chama na troca de rota: ficou de
 * fora, decisão no `TODO.md`. "Reduzir movimento": só esmaece (`template.module.css`).
 *
 * Um `template.tsx` não remonta entre duas páginas do mesmo grupo de rotas, então a animação é reiniciada por aqui, sem remontar nada: a classe da vez entra no
 * elemento e a animação é reposta (o que mantém o estado de quem está dentro).
 */
export default function TemplateDoPainel({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const elemento = useRef<HTMLDivElement>(null);
  const anterior = useRef<number | null>(null);

  useLayoutEffect(() => {
    const agora = fundura(caminho);
    const antes = anterior.current;
    anterior.current = agora;
    ultimoCaminho = window.location.pathname;
    const el = elemento.current;
    // A primeira tela da visita não anima (já está lá), e a mesma rota de novo (um refresh) também não.
    if (!el || antes === null) {
      foiVoltar = false;
      return;
    }
    let sentido: Sentido = "troca";
    if (foiVoltar) sentido = "volta";
    else if (agora > antes) sentido = "entra";
    else if (agora < antes) sentido = "volta";
    foiVoltar = false;
    el.className = styles[sentido];
    el.dataset.transicao = sentido;
    // Repõe a animação mesmo quando o nome dela não mudou (de "troca" para "troca").
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }, [caminho]);

  return (
    <div ref={elemento} data-transicao="inicial">
      {children}
    </div>
  );
}
