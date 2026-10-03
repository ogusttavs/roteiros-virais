"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import styles from "./template.module.css";

/** A fundura de uma rota: `/hoje` e `/criar` são o primeiro nível (as abas), `/roteiros/12` e `/criar/temas` são telas dentro delas. */
function fundura(caminho: string): number {
  return caminho.split("/").filter(Boolean).length;
}

// O Voltar do aparelho (ou do navegador) dispara `popstate` antes da rota trocar: guarda isso para a tela que chega entrar pelo outro lado.
let foiVoltar = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    foiVoltar = true;
  });
}

type Sentido = "troca" | "entra" | "volta";

/**
 * Passo 16 do Opus, capítulo 3 (entre telas), na forma que o Next 15 deixa fazer sem biblioteca: este `template` remonta a cada troca de rota e a tela que chega
 * anima na entrada; o cabeçalho e a cápsula ficam fora dele e não andam. Trocar de aba esmaece no lugar (180 ms); entrar num item (uma rota mais funda) desliza
 * da direita com a mola suave (360 ms); voltar (Voltar do aparelho, ou uma rota menos funda) desliza para o outro lado em 280 ms. Só `transform` e `opacity`, nunca
 * `left`/`right`. A tela de baixo recuar e escurecer (o desenho completo) pede a API de transição de view do navegador, que o roteador do Next 15 ainda não
 * chama na troca de rota: ficou de fora, decisão no `TODO.md`. "Reduzir movimento": só esmaece.
 */
export default function TemplateDoPainel({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const agora = fundura(caminho);

  // Decidido uma vez por montagem (o template remonta a cada rota), sem mexer em nada fora dele durante a renderização.
  const [sentido] = useState<Sentido>(() => {
    if (foiVoltar) return "volta";
    const antes = FUNDURA_ANTERIOR.valor;
    if (antes === null || agora === antes) return "troca";
    return agora > antes ? "entra" : "volta";
  });

  useEffect(() => {
    FUNDURA_ANTERIOR.valor = agora;
    foiVoltar = false;
  }, [agora]);

  return (
    <div className={styles[sentido]} data-transicao={sentido}>
      {children}
    </div>
  );
}

const FUNDURA_ANTERIOR: { valor: number | null } = { valor: null };
