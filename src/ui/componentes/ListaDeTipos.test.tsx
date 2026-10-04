/** A lista dos treze tipos de vídeo (passo 17): a ordem do estudo, o estado de cada chave, a marca "você ligou" e "você desligou" só para o que difere do padrão. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAVES_DE_FORMATO, FORMATOS_DO_CATALOGO } from "@/config/formatos";

import { ListaDeTipos } from "./ListaDeTipos";

afterEach(cleanup);

const PADRAO = Object.fromEntries(FORMATOS_DO_CATALOGO.map((f) => [f.chave, f.ligadaPorPadrao]));

describe("ListaDeTipos", () => {
  it("mostra as treze na ordem do estudo, cada uma com a frase e 'Por exemplo:'", () => {
    render(<ListaDeTipos estado={PADRAO} aoTrocar={() => {}} />);
    const itens = screen.getAllByRole("listitem");
    expect(itens.map((i) => i.getAttribute("data-tipo"))).toEqual(CHAVES_DE_FORMATO);
    expect(within(itens[0]).getByText("Você ensina a fazer alguma coisa, do começo ao resultado.")).toBeTruthy();
    expect(within(itens[0]).getByText(/Por exemplo: como tirar mancha de café/)).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(13);
  });

  it("os padrões: oito ligadas e cinco desligadas, e nenhuma marca de troca", () => {
    render(<ListaDeTipos estado={PADRAO} aoTrocar={() => {}} />);
    expect(screen.getAllByRole("switch").filter((s) => s.getAttribute("aria-checked") === "true")).toHaveLength(8);
    expect(screen.queryByText("você ligou")).toBeNull();
    expect(screen.queryByText("você desligou")).toBeNull();
  });

  it("o que difere do padrão vem marcado: ligou Opinião direta, desligou Lista; a ordem não muda", () => {
    render(<ListaDeTipos estado={{ ...PADRAO, opiniao_direta: true, lista: false }} aoTrocar={() => {}} />);
    expect(screen.getByText("você ligou")).toBeTruthy();
    expect(screen.getByText("você desligou")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((i) => i.getAttribute("data-tipo"))).toEqual(CHAVES_DE_FORMATO);
  });

  it("tocar numa chave avisa qual e para onde", () => {
    const aoTrocar = vi.fn();
    render(<ListaDeTipos estado={PADRAO} aoTrocar={aoTrocar} />);
    fireEvent.click(screen.getByRole("switch", { name: "Humor e meme" }));
    expect(aoTrocar).toHaveBeenCalledWith("humor_e_meme", true);
  });
});
