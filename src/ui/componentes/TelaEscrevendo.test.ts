import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { textosComuns } from "@/textos/comuns";

import { ConteudoTelaEscrevendo } from "./TelaEscrevendo";

describe("ConteudoTelaEscrevendo", () => {
  it("escrevendo: mostra o título, a frase da vez, a duração e o contador, sem erro nem Voltar depois", () => {
    const html = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: false,
        frase: textosComuns.espera[0],
        segundosDecorridos: 0,
      }),
    );
    expect(html).toContain(textosComuns.esperaTitulo);
    expect(html).toContain(textosComuns.espera[0]);
    expect(html).toContain(textosComuns.esperaDuracao);
    expect(html).toContain("0:00");
    expect(html).not.toContain("frase de demora do caminho");
    expect(html).not.toContain(textosComuns.esperaVoltarDepois);
  });

  /** R1, item 0b: "0:00" subindo de segundo em segundo, com zero à esquerda nos segundos, nunca nos minutos. */
  it("o contador formata minutos sem zero à esquerda e segundos com (1:05, não 01:05 nem 1:5)", () => {
    const html = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: false,
        frase: textosComuns.espera[0],
        segundosDecorridos: 65,
      }),
    );
    expect(html).toContain("1:05");
  });

  it("demorando: soma a frase do caminho; Voltar depois só aparece quando o caminho manda um, com ou sem demorando (R1, item 0b)", () => {
    const semVoltar = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: true,
        frase: textosComuns.espera[0],
        segundosDecorridos: 190,
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
        segundosDecorridos: 190,
      }),
    );
    expect(comVoltar).toContain(textosComuns.esperaVoltarDepois);
  });

  /**
   * R1, item 0b (pedido do Gustavo em 01/10): "Voltar depois continua disponível desde o
   * começo", não só depois de demorar; antes desta rodada o botão só aparecia com `demorando`.
   */
  it("Voltar depois aparece desde o começo, mesmo sem demorando, quando o caminho manda um", () => {
    const html = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: null,
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        aoVoltarDepois: vi.fn(),
        demorando: false,
        frase: textosComuns.espera[0],
        segundosDecorridos: 0,
      }),
    );
    expect(html).toContain(textosComuns.esperaVoltarDepois);
    expect(html).not.toContain("frase de demora do caminho");
  });

  it("erro: troca a espera pela frase de erro do caminho e o botão de novo, sem o título, a duração nem o contador", () => {
    const html = renderToStaticMarkup(
      createElement(ConteudoTelaEscrevendo, {
        erro: "não conseguimos escrever agora",
        fraseDemorando: "frase de demora do caminho",
        aoTentarDeNovo: vi.fn(),
        demorando: false,
        frase: textosComuns.espera[0],
        segundosDecorridos: 12,
      }),
    );
    expect(html).toContain("não conseguimos escrever agora");
    expect(html).toContain(textosComuns.tentarDeNovo);
    expect(html).not.toContain(textosComuns.esperaTitulo);
    expect(html).not.toContain(textosComuns.esperaDuracao);
    expect(html).not.toContain("0:12");
  });
});
