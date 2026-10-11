import { describe, expect, it } from "vitest";

import { reaisEmLinguagemDeGente, textosPesquisa } from "./pesquisa";

describe("reaisEmLinguagemDeGente", () => {
  it.each([
    [0.48, "uns R$ 0,50"],
    [0.92, "uns R$ 0,90"],
    [0.97, "uns R$ 0,95"],
    [1.2, "uns R$ 1,20"],
    [0.01, "uns R$ 0,05"],
  ])("%s", (valor, esperado) => {
    expect(reaisEmLinguagemDeGente(valor)).toBe(esperado);
  });
});

describe("textosPesquisa", () => {
  it("o número pequeno do roteiro diz a fonte ou as fontes", () => {
    expect(textosPesquisa.roteiro.fonteAria([1])).toBe("fonte 1");
    expect(textosPesquisa.roteiro.fonteAria([1, 2])).toBe("fontes 1 e 2");
    expect(textosPesquisa.roteiro.fonteAria([1, 2, 3])).toBe("fontes 1, 2 e 3");
  });

  it("o prefixo que a conferência põe no aviso sai da frase (o título da tela já o diz)", () => {
    const aviso = "O que você escreveu não bate com as fontes: o preço subiu 9,4%.";
    expect(aviso.replace(textosPesquisa.premissa.prefixo, "")).toBe("o preço subiu 9,4%.");
  });

  it("o 'Pesquisar de novo' diz o que gasta", () => {
    expect(textosPesquisa.tela.pesquisarDeNovo(1)).toBe("Pesquisar de novo (usa 1)");
    expect(textosPesquisa.tela.pesquisarDeNovo(2)).toBe("Pesquisar de novo (usa 2)");
  });

  it("a pesquisa que ficou para depois diz como terminou", () => {
    expect(textosPesquisa.emAberto.pronta("x")).toBe("Sua pesquisa está pronta: x");
    expect(textosPesquisa.emAberto.sem_achados("x")).toBe("A pesquisa não achou dado confiável: x");
    expect(textosPesquisa.emAberto.erro("x")).toBe("A pesquisa não terminou: x");
  });

  it("contagens no singular e no plural", () => {
    expect(textosPesquisa.tela.dadosEmFontes(1, 1)).toBe("1 dado em 1 fonte");
    expect(textosPesquisa.tela.dadosEmFontes(6, 4)).toBe("6 dados em 4 fontes");
    expect(textosPesquisa.roteiro.selo(1)).toBe("Com pesquisa: 1 dado");
    expect(textosPesquisa.roteiro.selo(3)).toBe("Com pesquisa: 3 dados");
    expect(textosPesquisa.roteiro.fontesNota(1, 1)).toBe("O 1 dado que você marcou na pesquisa. O roteiro só usa número que está aqui.");
    expect(textosPesquisa.roteiro.fontesNota(3, 3)).toBe("Os 3 que você marcou na pesquisa. O roteiro só usa número que está aqui.");
    // o selo conta os marcados; a lista, os que o roteiro usou: a nota não pode dizer que a pessoa marcou só os que foram usados
    expect(textosPesquisa.roteiro.fontesNota(2, 5)).toBe("As 2 que o roteiro usou, das 5 que você marcou na pesquisa. O roteiro só usa número que está aqui.");
    expect(textosPesquisa.roteiro.fontesNota(1, 4)).toBe("A 1 que o roteiro usou, das 4 que você marcou na pesquisa. O roteiro só usa número que está aqui.");
    expect(textosPesquisa.campo.semSaldo(3)).toBe("Você já usou as 3 pesquisas de hoje.");
    expect(textosPesquisa.campo.semSaldo(1)).toBe("Você já usou a pesquisa de hoje.");
  });
});
