import { describe, expect, it } from "vitest";

import { aplicarTetoPorConta } from "./teto-por-conta";

type ItemTeste = { id: string; contaId: number };

function item(id: string, contaId: number): ItemTeste {
  return { id, contaId };
}

function ids(lista: ItemTeste[]): string[] {
  return lista.map((i) => i.id);
}

describe("aplicarTetoPorConta", () => {
  it("lista sem repeticao de conta passa igual", () => {
    const lista = [item("a1", 1), item("b1", 2), item("c1", 3)];
    expect(ids(aplicarTetoPorConta(lista, (i) => i.contaId))).toEqual(["a1", "b1", "c1"]);
  });

  it("o terceiro seguido da mesma conta espera e entra depois do proximo de outra conta", () => {
    const lista = [item("a1", 1), item("a2", 1), item("a3", 1), item("b1", 2)];
    expect(ids(aplicarTetoPorConta(lista, (i) => i.contaId))).toEqual(["a1", "a2", "b1", "a3"]);
  });

  it("o quarto da mesma conta nunca entra, mesmo com espaco depois (teto total)", () => {
    const lista = [item("a1", 1), item("a2", 1), item("b1", 2), item("a3", 1), item("a4", 1), item("c1", 3)];
    const resultado = ids(aplicarTetoPorConta(lista, (i) => i.contaId));
    expect(resultado.filter((id) => id.startsWith("a"))).toHaveLength(3);
    expect(resultado).not.toContain("a4");
  });

  it("so uma conta com mais itens que o maximo seguido: corta em maxConsecutivos, mesmo com total sobrando", () => {
    // Sem nenhum outro item para intercalar, nao ha como os itens 3 e 4 nao ficarem
    // "seguidos" ao entrar; a regra de nao ficar seguido vence a de total ate 3.
    const lista = [item("a1", 1), item("a2", 1), item("a3", 1), item("a4", 1)];
    expect(ids(aplicarTetoPorConta(lista, (i) => i.contaId))).toEqual(["a1", "a2"]);
  });

  it("maxConsecutivos e maxTotal configuraveis", () => {
    const lista = [item("a1", 1), item("a2", 1), item("a3", 1), item("a4", 1), item("b1", 2)];
    expect(ids(aplicarTetoPorConta(lista, (i) => i.contaId, 3, 4))).toEqual(["a1", "a2", "a3", "b1", "a4"]);
  });

  it("lista vazia devolve vazia", () => {
    expect(aplicarTetoPorConta([], (i: ItemTeste) => i.contaId)).toEqual([]);
  });
});
