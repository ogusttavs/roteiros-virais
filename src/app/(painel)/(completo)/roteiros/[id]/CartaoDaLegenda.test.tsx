/**
 * E70: o cartão da legenda mostra e copia a legenda sem as hashtags; legenda que era só hashtag (ou vazia) some.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textosRoteiro } from "@/textos/roteiro";

import { CartaoDaLegenda } from "./CartaoDaLegenda";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CartaoDaLegenda", () => {
  it("mostra e copia a legenda sem as hashtags do modelo", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: escrever } });
    const aoCopiar = vi.fn();
    render(<CartaoDaLegenda legenda="O passo a passo que todo mundo salva #sorrisoperfeito #resultadogarantido" aoCopiar={aoCopiar} aoFalhar={vi.fn()} />);
    expect(screen.getByText("O passo a passo que todo mundo salva")).toBeTruthy();
    expect(screen.queryByText(/#sorrisoperfeito/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: textosRoteiro.menu.copiarLegenda }));
    await waitFor(() => expect(aoCopiar).toHaveBeenCalledTimes(1));
    expect(escrever).toHaveBeenCalledWith("O passo a passo que todo mundo salva");
  });

  it("legenda só de hashtags, vazia ou ausente: o cartão some", () => {
    for (const legenda of ["#um #dois", "", undefined]) {
      const { container } = render(<CartaoDaLegenda legenda={legenda} aoCopiar={vi.fn()} aoFalhar={vi.fn()} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });
});
