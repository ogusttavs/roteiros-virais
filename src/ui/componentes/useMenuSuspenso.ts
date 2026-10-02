"use client";

import { useEffect, useRef } from "react";

/**
 * O menu suspenso acessível de uma pílula de filtro (E39c... `PROXIMO.md`, "as pílulas de
 * filtro à vista em Referências"): nasce genérico de propósito, porque o admin novo (E46) vai
 * usar o mesmo. Abre com clique ou Enter (o próprio `<button>` do gatilho já faz isso sozinho,
 * nada a fazer aqui); fecha com Esc ou clique fora; as setas navegam entre os itens
 * (`[role^="menuitem"]` dentro do painel); o foco volta para o gatilho quando o fechamento
 * acontece com o foco preso dentro do painel (Esc, ou um item que chama `fechar`), nunca quando
 * fecha por um clique fora que já levou o foco para outro lugar.
 *
 * Não sabe se os itens são rádio (seleção única, fecha ao escolher) ou caixa (seleção múltipla,
 * `aria-checked`, continua aberto); isso é de quem chama, que decide se o próprio clique do item
 * também fecha o menu.
 */
export function useMenuSuspenso<TGatilho extends HTMLElement = HTMLButtonElement>(aberto: boolean, aoFechar: () => void) {
  const gatilhoRef = useRef<TGatilho>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function fechar() {
    const focoPreso = !!menuRef.current?.contains(document.activeElement);
    aoFechar();
    if (focoPreso) gatilhoRef.current?.focus();
  }

  useEffect(() => {
    if (!aberto) return;

    function itensDoMenu(): HTMLElement[] {
      return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    }

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.stopPropagation();
        fechar();
        return;
      }
      if (evento.key !== "ArrowDown" && evento.key !== "ArrowUp") return;
      evento.preventDefault();
      const itens = itensDoMenu();
      if (itens.length === 0) return;
      const atual = itens.indexOf(document.activeElement as HTMLElement);
      const proximo = evento.key === "ArrowDown" ? (atual + 1) % itens.length : (atual - 1 + itens.length) % itens.length;
      itens[proximo]?.focus();
    }

    function aoClicarFora(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (menuRef.current?.contains(alvo) || gatilhoRef.current?.contains(alvo)) return;
      aoFechar();
    }

    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("mousedown", aoClicarFora);
    itensDoMenu()[0]?.focus();

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("mousedown", aoClicarFora);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  return { gatilhoRef, menuRef, fechar };
}
