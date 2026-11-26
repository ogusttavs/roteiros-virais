/**
 * O aviso dos espaços para completar (26/11/2026): a frase curta no alto do roteiro e o toque que abre a edição.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textosRoteiro } from "@/textos/roteiro";

import { AvisoDeColchetes } from "./AvisoDeColchetes";

afterEach(cleanup);

const t = textosRoteiro.completarColchetes;

describe("AvisoDeColchetes", () => {
  it("diz o que fazer antes de gravar, como uma nota com título", () => {
    render(<AvisoDeColchetes aoCompletar={() => {}} />);
    const nota = screen.getByRole("note", { name: t.aviso });
    expect(nota.textContent).toContain(t.explicacao);
  });

  it("'Completar o roteiro' abre a edição", () => {
    const aoCompletar = vi.fn();
    render(<AvisoDeColchetes aoCompletar={aoCompletar} />);
    fireEvent.click(screen.getByRole("button", { name: t.botao }));
    expect(aoCompletar).toHaveBeenCalledTimes(1);
  });
});
