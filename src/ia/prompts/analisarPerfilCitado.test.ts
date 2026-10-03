import { describe, expect, it } from "vitest";

import { montarEntrada } from "./analisarPerfilCitado";

/** E38, partes 2 e 3: o papel do perfil (concorrente, admira, propria marca) muda a frase que o
 * prompt le, para o modelo focar no angulo certo (inspiracao, gosto, ou o que ja rende para o
 * proprio cliente). */
describe("montarEntrada, o papel por tipo", () => {
  it("concorrente: diz que o cliente citou", () => {
    const entrada = montarEntrada({ tipo: "concorrente", nomeDoCliente: "Loja", oQueVende: "limpeza", handle: "x", titulos: [] });
    expect(entrada).toContain("um concorrente que o cliente citou");
  });

  it("admira: diz que o cliente admira", () => {
    const entrada = montarEntrada({ tipo: "admira", nomeDoCliente: "Loja", oQueVende: "limpeza", handle: "x", titulos: [] });
    expect(entrada).toContain("um perfil que o cliente disse que admira");
  });

  it("propria_marca: diz que e o perfil do proprio cliente", () => {
    const entrada = montarEntrada({ tipo: "propria_marca", nomeDoCliente: "Loja", oQueVende: "limpeza", handle: "x", titulos: [] });
    expect(entrada).toContain("o perfil da própria marca do cliente");
  });

  it("sem titulo nenhum: a lista diz que nao ha titulo ou legenda disponivel, sem inventar", () => {
    const entrada = montarEntrada({ tipo: "concorrente", nomeDoCliente: "Loja", oQueVende: "limpeza", handle: "x", titulos: [] });
    expect(entrada).toContain("nenhum título ou legenda disponível");
  });

  it("com titulos: numerados, na ordem recebida", () => {
    const entrada = montarEntrada({
      tipo: "concorrente",
      nomeDoCliente: "Loja",
      oQueVende: "limpeza",
      handle: "x",
      titulos: ["Primeiro video", "Segundo video"],
    });
    expect(entrada).toContain("1. Primeiro video\n2. Segundo video");
  });
});

/** E38 PR 2 (versão 1.0.1): o handle do YouTube já vem com "@"; nunca "@@" na entrada. */
describe("montarEntrada, o arroba do handle", () => {
  it("Instagram e TikTok (sem arroba): ganha um", () => {
    const entrada = montarEntrada({ tipo: "concorrente", nomeDoCliente: "Loja", oQueVende: "limpeza", handle: "loja.exemplo", titulos: [] });
    expect(entrada).toContain("Perfil: @loja.exemplo, ");
  });

  it("YouTube (já com arroba): um só", () => {
    const entrada = montarEntrada({ tipo: "propria_marca", nomeDoCliente: "Loja", oQueVende: "limpeza", handle: "@canalexemplo", titulos: [] });
    expect(entrada).toContain("Perfil: @canalexemplo, ");
    expect(entrada).not.toContain("@@");
  });
});
