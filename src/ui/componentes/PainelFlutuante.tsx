"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import styles from "./PainelFlutuante.module.css";

const LARGURA_TABLET = 768;

type Props = {
  /** aria-label do painel. */
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  /** "menu" para uma lista de acoes (role="menuitem" nos filhos); "dialog" para formulario ou lista. */
  role?: "menu" | "dialog";
  /**
   * O botao que abre este painel, quando ele alterna aberto/fechado sozinho
   * (leitura previa do Fable no acabamento do iPad, item 1): sem isso, o
   * `mousedown` do clique nesse botao conta como "fora" e fecha o painel, e o
   * `click` do mesmo gesto reabre (o handler do botao ainda ve o estado
   * antigo). O clique dentro de `ignorar` nao fecha por clique fora; o
   * proprio botao continua decidindo abrir ou fechar.
   */
  ignorar?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/**
 * Um painel só, para os quatro que `/roteiros/[id]` abre (menu, postei,
 * ângulo, versões; `PROXIMO.md`, acabamento do iPad, item 1): no celular,
 * folha que sobe de baixo, fixa acima da barra de ações, com fundo
 * escurecido; do tablet para cima, painel ancorado no canto superior
 * direito, perto do botão "Mais ações" que os quatro reaproveitam como
 * ponto de abertura. Fecha ao clicar fora ou com Esc sempre.
 *
 * Fechar ao rolar a página de trás (mesma regra de `BarraNotaGeral`) só vale
 * do tablet para cima, e só para o menu: no celular a folha é modal (achado
 * do iPad, leitura prévia do Fable) e o próprio teclado rola a janela para
 * mostrar o campo em foco, o que fechava o formulário "Postei" no meio da
 * digitação; um formulário ancorado (tablet para cima) tem o mesmo problema
 * e também não fecha ao rolar.
 */
export function PainelFlutuante({
  titulo,
  aberto,
  aoFechar,
  role = "dialog",
  ignorar,
  children,
}: Props) {
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (ignorar?.current && ignorar.current.contains(alvo)) return;
      if (painelRef.current && !painelRef.current.contains(alvo)) aoFechar();
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFechar();
    }
    function aoRolar() {
      if (window.innerWidth < LARGURA_TABLET) return;
      if (role !== "menu") return;
      aoFechar();
    }

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    window.addEventListener("scroll", aoRolar, { passive: true });
    painelRef.current?.focus();

    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("scroll", aoRolar);
    };
  }, [aberto, aoFechar, ignorar, role]);

  if (!aberto) return null;

  return (
    <>
      <div className={styles.veu} aria-hidden="true" />
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
