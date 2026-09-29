import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTecladoAberto } from "./useTeclado";

/**
 * jsdom não implementa `visualViewport` de verdade: um `EventTarget` mínimo,
 * só com o que o gancho usa (`scale`, `height`, `resize`), controlado pelo
 * teste (H3, item 2).
 */
class VisualViewportFalso extends EventTarget {
  scale = 1;
  height = 800;
  dispararResize() {
    this.dispatchEvent(new Event("resize"));
  }
}

let vv: VisualViewportFalso;

beforeEach(() => {
  vv = new VisualViewportFalso();
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

afterEach(() => {
  document.body.innerHTML = "";
});

function encolherViewport(diferenca: number) {
  vv.height = 800 - diferenca;
  vv.dispararResize();
}

describe("useTecladoAberto (H3, item 2)", () => {
  it("sem campo em foco, a diferença de altura sozinha não conta mais como teclado aberto", () => {
    const { result } = renderHook(() => useTecladoAberto());

    act(() => encolherViewport(300));

    expect(result.current).toBe(false);
  });

  it("com um input em foco e a diferença acima do limiar, o teclado conta como aberto", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() => useTecladoAberto());
    act(() => encolherViewport(300));

    expect(result.current).toBe(true);
  });

  it("com um textarea ou contenteditable em foco, também conta (o briefing usa os dois)", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    const { result: resultTextarea } = renderHook(() => useTecladoAberto());
    act(() => encolherViewport(300));
    expect(resultTextarea.current).toBe(true);

    const editavel = document.createElement("div");
    editavel.contentEditable = "true";
    document.body.appendChild(editavel);
    editavel.focus();

    const { result: resultEditavel } = renderHook(() => useTecladoAberto());
    act(() => encolherViewport(300));
    expect(resultEditavel.current).toBe(true);
  });

  it("com o campo em foco mas a diferença abaixo do limiar (rolagem normal, sem teclado), continua fechado", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() => useTecladoAberto());
    act(() => encolherViewport(50));

    expect(result.current).toBe(false);
  });

  it("o campo perde o foco: fecha na hora, mesmo que o visualViewport ainda não tenha voltado ao tamanho inteiro (H3, item 2, achado do iPhone em modo aplicativo)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() => useTecladoAberto());
    act(() => encolherViewport(300));
    expect(result.current).toBe(true);

    act(() => {
      input.blur();
      document.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(result.current).toBe(false);
  });

  it("com zoom de pinça (escala acima de 1.01), não conta como teclado mesmo com campo em foco", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() => useTecladoAberto());
    act(() => {
      vv.scale = 1.5;
      encolherViewport(300);
    });

    expect(result.current).toBe(false);
  });
});
