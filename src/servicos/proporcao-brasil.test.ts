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

  /** Achado da revisão do PR #46: sem nenhum brasileiro, o resultado é vazio, nunca só internacional. */
  it("nada brasileiro: resultado vazio", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "en" },
      { id: 2, idioma: "es" },
      { id: 3, idioma: "en" },
      { id: 4, idioma: "es" },
      { id: 5, idioma: "en" },
    ];
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado).toEqual([]);
  });

  /**
   * Exemplo exato da revisão do PR #46: com 5 brasileiros e limite 40, o
   * teto de internacional é sobre os 5 aceitos (floor(5*0,3/0,7)=2), não
   * sobre o limite (que daria 12, o bug corrigido nesta rodada).
   */
  it("5 brasileiros e 20 internacionais, limite 40: devolve 5 mais 2, nao 5 mais 12", () => {
    const brasileiros: ItemTeste[] = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, idioma: "pt" }));
    const internacionais: ItemTeste[] = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, idioma: "en" }));
    const itens = [...brasileiros, ...internacionais];

    const resultado = aplicarProporcaoBrasil(itens, 40, classificar, 0.7);

    expect(resultado).toHaveLength(7);
    expect(resultado.filter((i) => i.id < 100)).toHaveLength(5);
    expect(resultado.filter((i) => i.id >= 100)).toHaveLength(2);
  });

  it("limite pequeno: limite 1 nao abre vaga nenhuma para internacional alem do proprio brasileiro", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "en" },
      { id: 2, idioma: "pt" },
    ];
    const resultado = aplicarProporcaoBrasil(itens, 1, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([2]);
  });

  /** A exceção: com pelo menos 1 brasileiro aceito, cabe pelo menos 1 internacional, mesmo quando floor() daria 0. */
  it("excecao: 1 brasileiro aceito ja abre 1 vaga internacional, mesmo com floor(1*0,3/0,7) = 0", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "pt" },
      { id: 2, idioma: "en" },
      { id: 3, idioma: "en" }, // excedente: so 1 internacional cabe
    ];
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([1, 2]);
  });

  it("outro no topo da prioridade e sempre pulado, mesmo em primeiro lugar", () => {
    const itens: ItemTeste[] = [
      { id: 1, idioma: "outro" },
      { id: 2, idioma: "pt" },
      { id: 3, idioma: "en" },
    ];
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([2, 3]);
  });

  it("mistura respeitando a ordem de prioridade, cortando so o internacional excedente", () => {
    // 3 brasileiros disponiveis (ids 2, 4, 7) => maxInternacional = floor(3*0,3/0,7) = 1.
    const itens: ItemTeste[] = [
      { id: 1, idioma: "en" },
      { id: 2, idioma: "pt" },
      { id: 3, idioma: "en" }, // excedente: ja bateu o teto de 1 internacional
      { id: 4, idioma: "pt" },
      { id: 5, idioma: "en" }, // excedente tambem
      { id: 6, idioma: "en" }, // excedente tambem
      { id: 7, idioma: "pt" },
      { id: 8, idioma: "en" }, // excedente tambem
    ];
    const resultado = aplicarProporcaoBrasil(itens, 10, classificar, 0.7);
    expect(resultado.map((i) => i.id)).toEqual([1, 2, 4, 7]);
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
