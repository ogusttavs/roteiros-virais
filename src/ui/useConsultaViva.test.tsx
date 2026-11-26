import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERVALO_DA_CONSULTA_MS, INTERVALO_SEM_REDE_MS, useConsultaViva } from "./useConsultaViva";

/**
 * E74 PR 2a (R-i, R-j): o consultador pergunta ao servidor só enquanto há algo em andamento e com a aba visível; a volta ao app (a aba fica visível de novo, ou o navegador devolve a página
 * guardada) pergunta na hora; sem rede, a próxima pergunta espera mais e `semRede` fica verdadeiro, sem nada mais mudar.
 */
let visibilidade: DocumentVisibilityState = "visible";

function mudarVisibilidade(estado: DocumentVisibilityState) {
  visibilidade = estado;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Deixa as promessas pendentes andarem (a pergunta é assíncrona). */
async function assentar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useConsultaViva", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibilidade = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidade);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sem nada em andamento, nenhuma pergunta sai", async () => {
    const consultar = vi.fn(async () => undefined);
    renderHook(() => useConsultaViva(false, consultar));
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_CONSULTA_MS * 5);
    });
    expect(consultar).not.toHaveBeenCalled();
  });

  it("com algo em andamento, pergunta de tempos em tempos, uma por vez", async () => {
    const consultar = vi.fn(async () => undefined);
    renderHook(() => useConsultaViva(true, consultar));
    expect(consultar).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_CONSULTA_MS);
    });
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_CONSULTA_MS);
    });
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it("com a aba escondida (a tela bloqueada, outro app), nada sai; ao voltar, uma pergunta sai na hora", async () => {
    const consultar = vi.fn(async () => undefined);
    renderHook(() => useConsultaViva(true, consultar));
    act(() => mudarVisibilidade("hidden"));
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_CONSULTA_MS * 6);
    });
    await assentar();
    expect(consultar).not.toHaveBeenCalled();
    act(() => mudarVisibilidade("visible"));
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it("a página devolvida pelo navegador (pageshow) também pergunta na hora", async () => {
    const consultar = vi.fn(async () => undefined);
    renderHook(() => useConsultaViva(true, consultar));
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it("sem rede: semRede fica verdadeiro e a próxima pergunta espera mais; a rede voltando apaga o aviso", async () => {
    let falhar = true;
    const consultar = vi.fn(async () => {
      if (falhar) throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useConsultaViva(true, consultar, { jaNaEntrada: true }));
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(result.current.semRede).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_CONSULTA_MS);
    });
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
    falhar = false;
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_SEM_REDE_MS - INTERVALO_DA_CONSULTA_MS);
    });
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(result.current.semRede).toBe(false);
  });

  it("consultarAgora pergunta sem esperar a batida; parado, não faz nada", async () => {
    const consultar = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(({ ativo }) => useConsultaViva(ativo, consultar), { initialProps: { ativo: true } });
    act(() => result.current.consultarAgora());
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
    rerender({ ativo: false });
    act(() => result.current.consultarAgora());
    await assentar();
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});
