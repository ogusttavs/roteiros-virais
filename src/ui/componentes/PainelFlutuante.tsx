"use client";

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./PainelFlutuante.module.css";

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
 * ponto de abertura. Fecha ao clicar fora, com Esc, ou ao rolar a página de
 * trás (mesma regra de `BarraNotaGeral`, para o painel nunca ficar aberto
 * sobre conteúdo que já rolou para outro lugar).
 */
export function PainelFlutuante({ titulo, aberto, aoFechar, role = "dialog", children }: Props) {
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      if (painelRef.current && !painelRef.current.contains(evento.target as Node)) aoFechar();
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFechar();
    }
    function aoRolar() {
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
  }, [aberto, aoFechar]);

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
