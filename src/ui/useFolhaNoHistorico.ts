"use client";

import { useCallback, useEffect, useRef } from "react";

const MARCA = "folhaAberta";

/**
 * O botão voltar (do Android, o gesto do iPhone, o do navegador) fecha a folha
 * em vez de sair da tela (V7, item 1 do PROXIMO.md). Vale para toda folha ou
 * painel que cobre a tela: Folha, PainelFlutuante, as doze notas, as marcas.
 *
 * Como funciona: ao abrir, empurra uma entrada no histórico do navegador
 * (`history.pushState`, o Next 15 aceita e a URL não muda). Voltar desfaz essa
 * entrada, e o `popstate` fecha a folha. O histórico é a fonte da verdade:
 * quem fecha por outro caminho (toque no véu, Esc, botão, arrastar) chama o
 * `fechar` devolvido aqui, que desfaz a entrada com `history.back()` e deixa o
 * mesmo `popstate` fechar. Assim o Voltar seguinte não precisa de dois toques.
 *
 * `fecharEDepois(acao)` é para o toque que fecha a folha E navega (aplicar
 * filtros, ir à Conta, abrir o roteiro reescrito): desfaz a entrada primeiro e
 * só então roda `acao`. Navegar antes de desfazer deixaria uma entrada
 * fantasma da mesma tela no meio do histórico.
 *
 * O efeito não desfaz nada na limpeza de propósito: em desenvolvimento o
 * React executa cada efeito duas vezes, e um `history.back()` na limpeza
 * fecharia a folha sozinha.
 *
 * `aoFechar` só precisa fechar (estado); pode mudar a cada renderização sem
 * mexer no histórico.
 */
export function useFolhaNoHistorico(
  aberto: boolean,
  aoFechar: () => void,
): { fechar: () => void; fecharEDepois: (acao: () => void) => void } {
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    window.history.pushState({ [MARCA]: true }, "");
    function aoVoltar() {
      aoFecharRef.current();
    }
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, [aberto]);

  const fechar = useCallback(() => {
    if (window.history.state?.[MARCA]) window.history.back();
    else aoFecharRef.current();
  }, []);

  const fecharEDepois = useCallback((acao: () => void) => {
    if (!window.history.state?.[MARCA]) {
      aoFecharRef.current();
      acao();
      return;
    }
    function depois() {
      window.removeEventListener("popstate", depois);
      acao();
    }
    // Registrado depois do ouvinte do efeito acima: no mesmo `popstate` a folha fecha primeiro e `acao` roda em seguida.
    window.addEventListener("popstate", depois);
    window.history.back();
  }, []);

  return { fechar, fecharEDepois };
}
