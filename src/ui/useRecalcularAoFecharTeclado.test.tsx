import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRecalcularAoFecharTeclado } from "./useRecalcularAoFecharTeclado";

beforeEach(() => {
  // `requestAnimationFrame` roda de verdade fora de um navegador (um `setTimeout` disfarçado, em
  // jsdom), sem sincronizar com `vi.advanceTimersByTime`; roda na hora aqui, so para o teste ser
  // deterministico, sem depender de um tempo de espera de verdade.
  vi.stubGlobal("requestAnimationFrame", (retorno: FrameRequestCallback) => {
    retorno(0);
    return 0;
  });
});

afterEach(() => {
  // Sem isto, o gancho da rodada anterior continua montado (os `addEventListener` em `document`
  // não têm limpeza automática entre `it()`s neste projeto, sem `setupFiles`) e reage aos eventos
  // da rodada seguinte também, contando de mais (achado escrevendo este teste).
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useRecalcularAoFecharTeclado (H3, item 3)", () => {
  it("100ms depois de um campo perder o foco, sem outro ganhar o foco, chama scrollTo para a própria posição", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollX", { value: 42, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 7, configurable: true });

    const { unmount } = renderHook(() => useRecalcularAoFecharTeclado());

    // jsdom dispara focusout/focusin de verdade a partir de .blur()/.focus(); nada de disparar o
    // evento à mão também (achado escrevendo este teste: duplicava o temporizador).
    act(() => {
      input.blur();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(42, 7);
    unmount();
  });

  it("se outro campo ganha o foco antes dos 100ms (trocar de campo), não recalcula", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const campo1 = document.createElement("input");
    const campo2 = document.createElement("input");
    document.body.append(campo1, campo2);
    campo1.focus();

    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    renderHook(() => useRecalcularAoFecharTeclado());

    act(() => {
      campo1.blur();
      campo2.focus();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("sem nenhum campo perdendo o foco, nunca recalcula", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    renderHook(() => useRecalcularAoFecharTeclado());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
