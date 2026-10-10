import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CartaoDeNoticia, veiculoEhLongo, type NoticiaNaTela } from "./CartaoDeNoticia";

afterEach(cleanup);

const BASE: NoticiaNaTela = {
  chave: "s-1",
  tipo: "setor",
  noticiaId: 1,
  assuntoId: null,
  origemRotulo: "Produtos de limpeza",
  titulo: "Uma manchete",
  veiculo: "G1",
  quando: "07:40",
  resumo: null,
  url: "https://g1.globo.com/a",
  imagemUrl: null,
  imagemCredito: null,
  roteiroId: null,
};

describe("o nome do veículo no bloco de tipografia (cartão sem foto)", () => {
  it("nome curto fica com a letra de sempre; nome comprido ou com palavra grande ganha a letra menor, para quebrar só entre palavras", () => {
    expect(veiculoEhLongo("G1")).toBe(false);
    expect(veiculoEhLongo("Folha de S.Paulo")).toBe(false);
    expect(veiculoEhLongo("Valor Econômico")).toBe(false);
    expect(veiculoEhLongo("Agência do Consumidor")).toBe(true);
    expect(veiculoEhLongo("Correio Braziliense Online")).toBe(true);
    expect(veiculoEhLongo("Superinteressante")).toBe(true);
  });

  it("o bloco do veículo comprido leva a classe da letra menor, e o curto não", () => {
    const { container, rerender } = render(<CartaoDeNoticia noticia={{ ...BASE, veiculo: "Agência do Consumidor" }} aoAbrir={() => {}} aoCriarRoteiro={() => {}} />);
    expect(container.querySelector("[class*='veiculoLongo']")).not.toBeNull();
    rerender(<CartaoDeNoticia noticia={{ ...BASE, veiculo: "G1" }} aoAbrir={() => {}} aoCriarRoteiro={() => {}} />);
    expect(container.querySelector("[class*='veiculoLongo']")).toBeNull();
  });

  it("com foto, o cartão mostra a imagem com o crédito e nenhum bloco de tipografia", () => {
    const { container } = render(
      <CartaoDeNoticia noticia={{ ...BASE, imagemUrl: "https://s2-g1.glbimg.com/a.jpg", imagemCredito: "Foto: G1" }} aoAbrir={() => {}} aoCriarRoteiro={() => {}} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://s2-g1.glbimg.com/a.jpg");
    expect(container.textContent).toContain("Foto: G1");
    expect(container.querySelector("[class*='semFoto']")).toBeNull();
  });
});
