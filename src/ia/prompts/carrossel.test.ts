import { describe, expect, it } from "vitest";

import { COMO_CONTAR, montarEntrada, montarSistemaEstavel, versao } from "./carrossel";

const sistema = montarSistemaEstavel({
  perfilCompilado: "perfil",
  modeloNicho: "modelo",
  camadaExclusiva: "camada",
  regrasCliente: [],
  tipo: "negocio",
  ramoSaude: false,
});
const entradaBase = {
  tema: "mancha de vinho",
  quantidade: 7 as const,
  anoDeHoje: 2026,
  evidencias: [],
  quantidadeDeFotos: 0,
};

describe("prompt do carrossel 2.2.0", () => {
  it("sobe a versão e traz as regras A, C, E e F e o que não se afirma da marca", () => {
    expect(versao).toBe("2.2.0");
    expect(sistema).toContain(COMO_CONTAR);
    expect(COMO_CONTAR).toContain("A. A capa promete e o carrossel cumpre");
    expect(COMO_CONTAR).toContain("exatamente N itens ou passos");
    expect(COMO_CONTAR).toContain('"O problema"');
    expect(COMO_CONTAR).toContain("Com 7 ou 9 slides");
    expect(COMO_CONTAR).toContain("UMA só ação");
    expect(COMO_CONTAR).toContain("com 9 slides o penúltimo é o resumo");
    expect(COMO_CONTAR).toContain("Use um formato diferente do último carrossel");
    expect(COMO_CONTAR).toContain("não afirme frequência, caso ou costume");
  });

  it("sem travessão e sem emoji", () => {
    expect(COMO_CONTAR).not.toMatch(new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]"));
    expect(COMO_CONTAR).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("o formato de cada carrossel recente chega na entrada, com a ordem de usar outro", () => {
    const e = montarEntrada({
      ...entradaBase,
      carrosseisRecentes: ["tema novo", "tema velho"],
      formatosDosRecentes: ["lista", "passo a passo"],
    });
    expect(e).toContain('"tema novo" (formato: lista); "tema velho" (formato: passo a passo)');
    expect(e).toContain(
      "O último carrossel desta marca foi em formato lista: use um formato diferente.",
    );
  });

  it("sem formato ou sem carrossel anterior, a entrada segue como antes", () => {
    expect(montarEntrada({ ...entradaBase, carrosseisRecentes: ["a"] })).toContain(
      "para não repetir o ângulo:" + String.fromCharCode(10) + '"a"',
    );
    expect(
      montarEntrada({ ...entradaBase, carrosseisRecentes: ["a"], formatosDosRecentes: [""] }),
    ).not.toContain("formato diferente");
    expect(montarEntrada({ ...entradaBase, carrosseisRecentes: [] })).toContain(
      "nenhum carrossel anterior",
    );
  });
});
