/** A chave de ligar (passo 17): um `role="switch"` com o nome do tipo ao lado, que troca por clique e pelo teclado (Espaço e Enter, como todo `<button>`). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChaveLiga } from "./ChaveLiga";

afterEach(cleanup);

describe("ChaveLiga", () => {
  it("é um switch com o nome do rótulo e o estado em aria-checked", () => {
    render(
      <>
        <span id="nome-do-tipo">Passo a passo</span>
        <ChaveLiga ligada rotuladaPor="nome-do-tipo" aoTrocar={() => {}} />
      </>,
    );
    const chave = screen.getByRole("switch", { name: "Passo a passo" });
    expect(chave.getAttribute("aria-checked")).toBe("true");
  });

  it("o clique pede o estado contrário, e ligada vira desligada", () => {
    const aoTrocar = vi.fn();
    render(
      <>
        <span id="x">Lista</span>
        <ChaveLiga ligada={false} rotuladaPor="x" aoTrocar={aoTrocar} />
      </>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Lista" }));
    expect(aoTrocar).toHaveBeenCalledWith(true);
  });

  it("é um botão (recebe foco e troca por Espaço e Enter no navegador) e desabilitada não troca", () => {
    const aoTrocar = vi.fn();
    render(
      <>
        <span id="y">Bastidor</span>
        <ChaveLiga ligada rotuladaPor="y" aoTrocar={aoTrocar} desabilitada />
      </>,
    );
    const chave = screen.getByRole("switch", { name: "Bastidor" });
    expect(chave.tagName).toBe("BUTTON");
    fireEvent.click(chave);
    expect(aoTrocar).not.toHaveBeenCalled();
  });
});
