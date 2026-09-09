"use client";

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./PainelFlutuante.module.css";

const LARGURA_TABLET = 768;

type Props = {
  /** aria-label do painel. */
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  /** "menu" para uma lista de acoes (role="menuitem" nos filhos); "dialog" para formulario ou lista. */
  role?: "menu" | "dialog";
  children: ReactNode;
};

/**
 * Um painel só, para os quatro que `/roteiros/[id]` abre (menu, postei,
 * ângulo, versões; `PROXIMO.md`, acabamento do iPad, item 1): no celular,
 * folha que sobe de baixo, fixa acima da barra de ações, com fundo
 * escurecido; do tablet para cima, painel ancorado no canto superior
 * direito, perto do botão "Mais ações" que os quatro reaproveitam como
 * ponto de abertura.
 *
 * O véu cobre a tela inteira e recebe o clique (ajuste da revisão do PR
 * #33, item 1): a primeira versão deixava o clique passar por baixo dele
 * (`pointer-events: none`) para o botão que abriu o painel conseguir
 * alternar; o efeito colateral era o toque atrás do véu escurecido, no
 * celular, chegar ao que está por baixo (um toque perto de "Já gravei"
 * fechava a folha e marcava como gravado ao mesmo tempo). Com o véu de
 * volta cobrindo o toque, um clique no botão que abriu o painel cai no véu
 * (que está por cima) e só fecha; não precisa mais de um caso especial para
 * esse botão, e o `document` não precisa ouvir clique fora, porque não
 * sobra nenhum lugar clicável fora do véu ou do próprio painel enquanto ele
 * está aberto.
 *
 * Fechar ao rolar a página de trás (mesma regra de `BarraNotaGeral`) só vale
 * do tablet para cima, e só para o menu: no celular a folha é modal (achado
 * do iPad, leitura prévia do Fable) e o próprio teclado rola a janela para
 * mostrar o campo em foco, o que fechava o formulário "Postei" no meio da
 * digitação; um formulário ancorado (tablet para cima) tem o mesmo problema
 * e também não fecha ao rolar.
 */
export function PainelFlutuante({ titulo, aberto, aoFechar, role = "dialog", children }: Props) {
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFechar();
    }
    function aoRolar() {
      if (window.innerWidth < LARGURA_TABLET) return;
      if (role !== "menu") return;
      aoFechar();
    }

    document.addEventListener("keydown", aoTeclar);
    window.addEventListener("scroll", aoRolar, { passive: true });
    painelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("scroll", aoRolar);
    };
  }, [aberto, aoFechar, role]);

  if (!aberto) return null;

  return (
    <>
      <div className={styles.veu} onClick={aoFechar} aria-hidden="true" />
      <div
        ref={painelRef}
        role={role}
        aria-modal={role === "dialog" ? true : undefined}
        aria-label={titulo}
        tabIndex={-1}
        className={styles.painel}
      >
        <span className={styles.alca} aria-hidden="true" />
        {children}
      </div>
    </>
  );
}
