"use client";

import { useCallback, useEffect, useRef } from "react";

/** O que a entrada empurrada carrega no estado do histórico (só para quem inspeciona; a decisão não depende dele). */
const MARCA = "folhaAberta";

/**
 * Se o `popstate` do `history.back()` não vier neste tempo (na prática nunca acontece: a entrada empurrada sempre
 * tem uma anterior), a folha fecha só pelo estado e a ação pendente roda mesmo assim, para a pessoa nunca ficar
 * presa numa folha que não fecha. Longo de propósito: sob carga o `popstate` chegou depois de 1 s e a ação de
 * "Ver os N vídeos" era descartada (achado do e2e completo da V7).
 */
const ESPERA_POPSTATE_MS = 4000;

/**
 * O botão voltar (do Android, o gesto do iPhone, o do navegador) fecha a folha
 * em vez de sair da tela (V7, item 1 do PROXIMO.md). Vale para toda folha ou
 * painel que cobre a tela: Folha, PainelFlutuante, as doze notas, as marcas.
 *
 * Como funciona: ao abrir, empurra uma entrada no histórico do navegador
 * (`history.pushState`, o Next 15 aceita e a URL não muda). Voltar desfaz essa
 * entrada, e o `popstate` chama `aoFechar`. O histórico é a fonte da verdade:
 * quem fecha por outro caminho (toque no véu, Esc, botão, arrastar) chama o
 * `fechar` devolvido aqui, que desfaz a entrada com `history.back()` e deixa o
 * mesmo `popstate` fechar. Assim o Voltar seguinte não precisa de dois toques.
 *
 * Quem sabe se a entrada ainda está no histórico é este gancho (um ref), NÃO o
 * `history.state`: o Next refaz o estado (`replaceState`) a cada `refresh` ou
 * Server Action que termina com a folha aberta, e a marca some sem a entrada
 * sair do lugar (achado da revisão do pacote 3 da V7, lido em
 * `refresh-reducer.js` e `server-action-reducer.js`).
 *
 * `aoFechar` fecha (estado) e pode RECUSAR devolvendo `false` (uma reescrita
 * em andamento, por exemplo): o gancho devolve a entrada ao histórico e o
 * próximo Voltar volta a pedir para fechar. `aoFechar` pode mudar a cada
 * renderização sem mexer no histórico.
 *
 * `fechar` e `fecharEDepois` são idempotentes: um segundo pedido antes do
 * `popstate` chegar (um toque duplo, uma rolagem que dispara vários eventos)
 * é ignorado. Sem isso o segundo `history.back()` tiraria a pessoa da tela.
 *
 * `fecharEDepois(acao)` é para o toque que fecha a folha E navega (aplicar
 * filtros, ir à Conta, abrir o roteiro reescrito): desfaz a entrada primeiro e
 * só então roda `acao`. Navegar antes de desfazer deixaria uma entrada
 * fantasma da mesma tela no meio do histórico. Se a tela recusar o fechamento,
 * `acao` não roda.
 *
 * O efeito não desfaz nada na limpeza de propósito: em desenvolvimento o
 * React executa cada efeito duas vezes, e um `history.back()` na limpeza
 * fecharia a folha sozinha.
 */
export function useFolhaNoHistorico(
  aberto: boolean,
  aoFechar: () => boolean | void,
): { fechar: () => void; fecharEDepois: (acao: () => void) => void } {
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  /** Empurramos uma entrada e ela ainda está no histórico. */
  const empurradoRef = useRef(false);
  /** `history.back()` pedido e o `popstate` ainda não chegou. */
  const voltandoRef = useRef(false);
  /** A tela recusou o último fechamento (o gancho devolveu a entrada); `fecharEDepois` então não roda a ação. */
  const recusouRef = useRef(false);
  /** O tempo de espera do `popstate` de `fechar`, para o `popstate` que chega o cancelar. */
  const esperaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const empurrar = useCallback(() => {
    window.history.pushState({ [MARCA]: true }, "");
    empurradoRef.current = true;
  }, []);

  useEffect(() => {
    if (!aberto) return;
    empurrar();
    function aoVoltar() {
      if (esperaRef.current) clearTimeout(esperaRef.current);
      esperaRef.current = null;
      empurradoRef.current = false;
      voltandoRef.current = false;
      recusouRef.current = aoFecharRef.current() === false;
      if (recusouRef.current) empurrar();
    }
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, [aberto, empurrar]);

  const fechar = useCallback(() => {
    if (voltandoRef.current) return;
    if (!empurradoRef.current) {
      aoFecharRef.current();
      return;
    }
    voltandoRef.current = true;
    window.history.back();
    esperaRef.current = setTimeout(() => {
      esperaRef.current = null;
      voltandoRef.current = false;
      empurradoRef.current = false;
      aoFecharRef.current();
    }, ESPERA_POPSTATE_MS);
  }, []);

  const fecharEDepois = useCallback((acao: () => void) => {
    if (voltandoRef.current) return;
    if (!empurradoRef.current) {
      if (aoFecharRef.current() !== false) acao();
      return;
    }
    voltandoRef.current = true;
    function depois() {
      window.removeEventListener("popstate", depois);
      clearTimeout(desistir);
      if (!recusouRef.current) acao();
    }
    // Registrado depois do ouvinte do efeito acima: no mesmo `popstate` a folha fecha (ou recusa) primeiro e `acao` roda em seguida.
    window.addEventListener("popstate", depois);
    const desistir = setTimeout(() => {
      // O `popstate` não veio: fecha pelo estado e faz o que a pessoa pediu.
      window.removeEventListener("popstate", depois);
      voltandoRef.current = false;
      empurradoRef.current = false;
      if (aoFecharRef.current() !== false) acao();
    }, ESPERA_POPSTATE_MS);
    window.history.back();
  }, []);

  return { fechar, fecharEDepois };
}
