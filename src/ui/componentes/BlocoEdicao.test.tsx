/**
 * T112 (26/11/2026): "Como editar" com o "Texto na tela" em lista, um momento por linha (o tempo, a frase e a posição), em vez do parágrafo corrido; sem lista, o texto de sempre.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { Eye, Scissors, Type } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { BlocoEdicao } from "./BlocoEdicao";

afterEach(cleanup);

describe("BlocoEdicao", () => {
  it("um item com lista mostra uma linha por momento, com o tempo, a frase e a posição, no lugar do texto corrido", () => {
    render(
      <BlocoEdicao
        titulo="Como editar"
        itens={[
          {
            icone: Type,
            rotulo: "Texto na tela",
            texto: "0 a 3 segundos: “Primeira”; 8 a 14 segundos: “Segunda”",
            lista: [
              { quando: "0 a 3 segundos", texto: "“Primeira”", detalhe: "Terço superior" },
              { quando: "8 a 14 segundos", texto: "“Segunda”", detalhe: "Centro da tela" },
            ],
          },
        ]}
      />,
    );
    const item = screen.getByText("Texto na tela").closest("li")!;
    const linhas = within(item).getAllByRole("listitem");
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toBe("0 a 3 segundos“Primeira”Terço superior");
    expect(linhas[1].textContent).toBe("8 a 14 segundos“Segunda”Centro da tela");
    expect(item.textContent).not.toContain("0 a 3 segundos: ");
  });

  it("uma lista sem tempo (os recursos) é uma lista simples, um recurso por linha", () => {
    render(
      <BlocoEdicao
        titulo="Como editar"
        itens={[{ icone: Eye, rotulo: "Recursos", texto: "zoom; seta", lista: [{ texto: "zoom" }, { texto: "seta" }] }]}
      />,
    );
    const item = screen.getByText("Recursos").closest("li")!;
    expect(within(item).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["zoom", "seta"]);
  });

  it("sem lista, o item mostra o texto de sempre", () => {
    render(<BlocoEdicao titulo="Como editar" itens={[{ icone: Scissors, rotulo: "Ritmo de corte", texto: "Corte a cada 2 segundos." }]} />);
    const item = screen.getByText("Ritmo de corte").closest("li")!;
    expect(within(item).queryAllByRole("listitem")).toHaveLength(0);
    expect(item.textContent).toContain("Corte a cada 2 segundos.");
  });
});
