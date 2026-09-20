import { describe, expect, it } from "vitest";

import { aplicarProporcaoBrasil, classificarBrasil, contaEhBrasileira } from "./proporcao-brasil";

type ItemTeste = { id: number; idioma: string | null; contaBrasileira?: boolean };

function classificar(item: ItemTeste) {
  return classificarBrasil(item.idioma, item.contaBrasileira ?? true);
}

describe("classificarBrasil", () => {
  it("pt e pt-BR sao brasileiro", () => {
    expect(classificarBrasil("pt", false)).toBe("brasileiro");
    expect(classificarBrasil("pt-BR", false)).toBe("brasileiro");
  });

  it("en, es e pt-PT sao internacional", () => {
    expect(classificarBrasil("en", true)).toBe("internacional");
    expect(classificarBrasil("es", true)).toBe("internacional");
    expect(classificarBrasil("pt-PT", true)).toBe("internacional");
  });

  it("outro e sempre outro, mesmo com conta brasileira", () => {
    expect(classificarBrasil("outro", true)).toBe("outro");
  });

  it("idioma nulo conta como brasileiro so quando a conta e brasileira", () => {
    expect(classificarBrasil(null, true)).toBe("brasileiro");
    expect(classificarBrasil(null, false)).toBe("internacional");
  });
});

describe("contaEhBrasileira", () => {
  it("pais BR e sempre brasileira, mesmo sem idioma principal", () => {
    expect(contaEhBrasileira("BR", null)).toBe(true);
  });

  it("idioma principal pt ou pt-BR conta como brasileira, sem pais gravado", () => {
    expect(contaEhBrasileira(null, "pt")).toBe(true);
    expect(contaEhBrasileira(null, "pt-BR")).toBe(true);
  });

  it("outro pais e outro idioma principal: nao e brasileira", () => {
    expect(contaEhBrasileira("US", "en")).toBe(false);
    expect(contaEhBrasileira(null, "en")).toBe(false);
    expect(contaEhBrasileira(null, null)).toBe(false);
  });
});

describe("aplicarProporcaoBrasil", () => {
  it("tudo brasileiro: devolve todos ate o limite, sem cortar por proporcao", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "pt" },
      { id: 2, idioma: "pt" },
      { id: 3, idioma: "pt" },
      { id: 4, idioma: "pt" },
      { id: 5, idioma: "pt" },
    ];
    const resultado = aplicarProporcaoBrasil(itens, 5, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("nada brasileiro: a lista fica menor que o limite, nunca completa com mais internacional", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "en" },
      { id: 2, idioma: "es" },
      { id: 3, idioma: "en" },
      { id: 4, idioma: "es" },
      { id: 5, idioma: "en" },
    ];
    // limite 10, proporcaoBrasil 0.7 => no maximo 3 internacionais (floor(10*0.3)).
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("limite pequeno: limite 1 nao abre vaga nenhuma para internacional (floor(1*0.3) = 0)", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "en" },
      { id: 2, idioma: "pt" },
    ];
    const resultado = aplicarProporcaoBrasil(itens, 1, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([2]);
  });

  it("outro no topo da prioridade e sempre pulado, mesmo em primeiro lugar", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "outro" },
      { id: 2, idioma: "pt" },
      { id: 3, idioma: "en" },
    ];
    // limite 10 (nao 3): com limite pequeno o teto de internacional some (caso
    // ja coberto pelo teste "limite pequeno" acima); aqui o que se testa e so
    // que "outro" nunca entra, em qualquer posicao.
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([2, 3]);
  });

  it("mistura respeitando a ordem de prioridade, cortando so o internacional excedente", () => {
    // limite 10, max internacional = 3. Cinco internacionais na fila, so os tres
    // primeiros (por prioridade) entram; os brasileiros entram todos.
    const itens: ItemTeste[] = [
      { id: 1, idioma: "en" },
      { id: 2, idioma: "pt" },
      { id: 3, idioma: "en" },
      { id: 4, idioma: "pt" },
      { id: 5, idioma: "en" },
      { id: 6, idioma: "en" }, // excedente: ja bateu o teto de 3 internacionais
      { id: 7, idioma: "pt" },
      { id: 8, idioma: "en" }, // excedente tambem
    ];
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("idioma nulo com conta brasileira conta como brasileiro, sem conta internacional", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: null, contaBrasileira: true },
      { id: 2, idioma: null, contaBrasileira: false },
    ];
    const resultado = aplicarProporcaoBrasil(itens, 1, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([1]);
  });
});
