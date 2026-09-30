import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFolhaNoHistorico } from "./useFolhaNoHistorico";

/**
 * `fecharENavegar` (V12b, ajuste A do PR #66): o caso novo. Achado da revisão
 * do Fable: `fecharEDepois` chama `history.back()` e só roda a ação no
 * `popstate` que ele dispara; o App Router escuta o mesmo `popstate` para
 * restaurar a árvore da URL anterior, e quando essa restauração termina
 * depois do `router.push`/`replace` de `acao`, a tela volta para onde
 * estava. `fecharENavegar` nunca chama `history.back()`: fecha pelo estado
 * (`aoFechar`) e roda `navegar` dois quadros depois, sem nenhum `popstate`
 * para competir (F1, item 2a: nunca no mesmo tique do fechamento).
 *
 * `requestAnimationFrame` roda de verdade fora de um navegador (um
 * `setTimeout` disfarçado, em jsdom); o stub abaixo (mesmo padrão de
 * `useRecalcularAoFecharTeclado.test.tsx`) o faz rodar na hora, só para os
 * testes serem determinísticos.
 */
describe("useFolhaNoHistorico, fecharENavegar", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (retorno: FrameRequestCallback) => {
      retorno(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("nunca chama history.back(): fecha pelo estado e navega dois quadros depois, sem passar pelo popstate", () => {
    const aoFechar = vi.fn();
    const historyBack = vi.spyOn(window.history, "back");
    const { result } = renderHook(({ aberto }) => useFolhaNoHistorico(aberto, aoFechar), {
      initialProps: { aberto: true },
    });

    const navegar = vi.fn();
    act(() => {
      result.current.fecharENavegar(navegar);
    });

    expect(historyBack).not.toHaveBeenCalled();
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledTimes(1);

    historyBack.mockRestore();
  });

  it("a tela pode recusar (aoFechar devolve false): nem fecha nem navega", () => {
    const aoFechar = vi.fn(() => false as const);
    const { result } = renderHook(({ aberto }) => useFolhaNoHistorico(aberto, aoFechar), {
      initialProps: { aberto: true },
    });

    const navegar = vi.fn();
    act(() => {
      result.current.fecharENavegar(navegar);
    });

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(navegar).not.toHaveBeenCalled();
  });

  it("um segundo toque antes do primeiro terminar é ignorado (idempotente, como fecharEDepois)", () => {
    const aoFechar = vi.fn();
    const { result } = renderHook(({ aberto }) => useFolhaNoHistorico(aberto, aoFechar), {
      initialProps: { aberto: true },
    });

    const navegar = vi.fn();
    act(() => {
      // fecharEDepois usa history.back() de verdade (jsdom simula), entao o segundo toque, sincrono,
      // ainda ve `voltandoRef` marcado antes do popstate assentar.
      result.current.fecharEDepois(() => undefined);
      result.current.fecharENavegar(navegar);
    });

    expect(navegar).not.toHaveBeenCalled();
  });

  it("sem folha aberta ainda (nada empurrado no histórico), fecharENavegar continua fechando e navegando", () => {
    const aoFechar = vi.fn();
    const { result } = renderHook(({ aberto }) => useFolhaNoHistorico(aberto, aoFechar), {
      initialProps: { aberto: false },
    });

    const navegar = vi.fn();
    act(() => {
      result.current.fecharENavegar(navegar);
    });

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledTimes(1);
  });
});
