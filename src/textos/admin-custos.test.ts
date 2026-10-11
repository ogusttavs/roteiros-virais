import { describe, expect, it } from "vitest";

import { textosCustosAdmin } from "./admin-custos";

const p = textosCustosAdmin.pesquisas;

describe("textos das pesquisas na hora no admin (E54 parte 4)", () => {
  it("por tamanho: diz quantas gastaram, no singular e no plural, e a busca média no singular quando é uma", () => {
    expect(p.porTamanho("Rápida", 2, "R$ 0,11", 4.5, "uns R$ 0,50", "R$ 0,48", 5)).toBe(
      "Rápida: 2 pesquisas que gastaram, R$ 0,11 em média e 4,5 buscas. A tela diz uns R$ 0,50 (estimativa do motor R$ 0,48, até 5 buscas).",
    );
    expect(p.porTamanho("Rápida", 1, "R$ 0,11", 1, "uns R$ 0,50", "R$ 0,48", 5)).toBe(
      "Rápida: 1 pesquisa que gastou, R$ 0,11 em média e 1 busca. A tela diz uns R$ 0,50 (estimativa do motor R$ 0,48, até 5 buscas).",
    );
  });

  it("por tamanho: sem pesquisa medida, diz isso e mostra só o que a tela diz", () => {
    expect(p.porTamanho("Mais a fundo", 0, null, null, "uns R$ 0,90", "R$ 0,92", 10)).toBe(
      "Mais a fundo: ainda sem pesquisa medida. A tela diz uns R$ 0,90 (estimativa do motor R$ 0,92, até 10 buscas).",
    );
  });

  it("o resumo concorda no singular e no plural", () => {
    expect(p.resumo(1, 1)).toBe("1 pesquisa, 1 marca");
    expect(p.resumo(3, 2)).toBe("3 pesquisas, 2 marcas");
    expect(p.desfechos(1, 0, 0, 0)).toBe("1 pronta, 0 sem dado confiável, 0 com erro");
    expect(p.desfechos(2, 1, 1, 2)).toBe("2 prontas, 1 sem dado confiável, 1 com erro, 2 rodando");
    expect(p.viraramRoteiro(0)).toBe("nenhuma virou roteiro");
    expect(p.viraramRoteiro(1)).toBe("1 virou roteiro");
    expect(p.viraramRoteiro(3)).toBe("3 viraram roteiro");
  });

  it("a nota recebe o preço da busca (não o fixa) e diz que a de prazo estourado aparece com custo zero", () => {
    const nota = p.nota(3, 2, "US$ 0,01");
    expect(nota).toContain("(US$ 0,01 cada)");
    expect(nota).toContain("Cada marca pode fazer 3 pesquisas por dia");
    expect(nota).toContain("custo zero");
    const outra = p.nota(1, 2, "US$ 0,02");
    expect(outra).toContain("Cada marca pode fazer 1 pesquisa por dia");
    expect(outra).toContain("(US$ 0,02 cada)");
  });

  it("o tempo passa a minutos quando passa de um minuto e meio", () => {
    expect(p.segundos(25)).toBe("25 s");
    expect(p.segundos(89)).toBe("89 s");
    expect(p.segundos(125)).toBe("2 min 05 s");
  });
});
