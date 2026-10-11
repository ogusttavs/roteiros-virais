import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { passoDaPesquisa, TelaPesquisando } from "./TelaPesquisando";

describe("passoDaPesquisa", () => {
  it.each([
    [0, 0],
    [14, 0],
    [15, 1],
    [39, 1],
    [40, 2],
    [200, 2],
  ])("%s segundos acendem o passo %s", (segundos, passo) => {
    expect(passoDaPesquisa(segundos)).toBe(passo);
  });
});

describe("TelaPesquisando no servidor", () => {
  it("nascer aberta (a pesquisa ainda roda quando a pessoa chega) não quebra a renderização do servidor, que não tem `document`", () => {
    expect(() => renderToStaticMarkup(createElement(TelaPesquisando, { aberto: true, pedido: "quanto subiu o preço", aoVoltarDepois: () => undefined }))).not.toThrow();
    // o portal só existe depois da montagem: no servidor, nada
    expect(renderToStaticMarkup(createElement(TelaPesquisando, { aberto: true, pedido: "x", aoVoltarDepois: () => undefined }))).toBe("");
  });
});
