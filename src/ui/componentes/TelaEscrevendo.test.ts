import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { textosComuns } from "@/textos/comuns";

import { ConteudoTelaEscrevendo } from "./TelaEscrevendo";

describe("ConteudoTelaEscrevendo", () => {
  it("escrevendo: mostra o título, a frase da vez e a duração, sem erro nem Voltar depois", () => {
    const html = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: false,
        frase: textosComuns.espera[0],
      }),
    );
    expect(html).toContain(textosComuns.esperaTitulo);
    expect(html).toContain(textosComuns.espera[0]);
    expect(html).toContain(textosComuns.esperaDuracao);
    expect(html).not.toContain("frase de demora do caminho");
    expect(html).not.toContain(textosComuns.esperaVoltarDepois);
  });

  it("demorando: soma a frase do caminho; só mostra Voltar depois quando o caminho manda um", () => {
    const semVoltar = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: true,
        frase: textosComuns.espera[0],
      }),
    );
    expect(semVoltar).toContain("frase de demora do caminho");
    expect(semVoltar).not.toContain(textosComuns.esperaVoltarDepois);

    const comVoltar = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        aoVoltarDepois: vi.fn(),
        demorando: true,
        frase: textosComuns.espera[0],
      }),
    );
    expect(comVoltar).toContain(textosComuns.esperaVoltarDepois);
  });

  it("erro: troca a espera pela frase de erro do caminho e o botão de novo, sem o título nem a duração", () => {
    const html = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: "não conseguimos escrever agora",
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: false,
        frase: textosComuns.espera[0],
      }),
    );
    expect(html).toContain("não conseguimos escrever agora");
    expect(html).toContain(textosComuns.tentarDeNovo);
    expect(html).not.toContain(textosComuns.esperaTitulo);
    expect(html).not.toContain(textosComuns.esperaDuracao);
  });
});
