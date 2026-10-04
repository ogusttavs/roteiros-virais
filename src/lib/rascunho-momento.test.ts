import { describe, expect, it } from "vitest";

import { apagarRascunhoDoMomento, chaveDoRascunhoDoMomento, gravarRascunhoDoMomento, lerRascunhoDoMomento, rascunhoEstaVazio } from "./rascunho-momento";

function armazenamentoDeMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => void dados.set(c, v),
    removeItem: (c: string) => void dados.delete(c),
    dados,
  };
}

const R = { onde: "na oficina", oQueEstaAcontecendo: "um sofá manchado", oQueDaParaMostrar: "o antes e o depois", objetivoDoVideo: "", transcricao: null };

describe("o rascunho do momento", () => {
  it("a chave é por marca", () => {
    expect(chaveDoRascunhoDoMomento(1)).not.toBe(chaveDoRascunhoDoMomento(2));
  });

  it("grava e lê de volta, e é por marca: a outra marca não vê o texto", () => {
    const a = armazenamentoDeMemoria();
    gravarRascunhoDoMomento(a, chaveDoRascunhoDoMomento(1), { ...R, transcricao: "falei assim" });
    expect(lerRascunhoDoMomento(a, chaveDoRascunhoDoMomento(1))).toEqual({ ...R, transcricao: "falei assim" });
    expect(lerRascunhoDoMomento(a, chaveDoRascunhoDoMomento(2))).toBeNull();
  });

  it("um rascunho vazio apaga a chave, e apagar de propósito também", () => {
    const a = armazenamentoDeMemoria();
    const chave = chaveDoRascunhoDoMomento(7);
    gravarRascunhoDoMomento(a, chave, R);
    expect(a.dados.has(chave)).toBe(true);
    gravarRascunhoDoMomento(a, chave, { onde: " ", oQueEstaAcontecendo: "", oQueDaParaMostrar: "", objetivoDoVideo: "", transcricao: null });
    expect(a.dados.has(chave)).toBe(false);
    gravarRascunhoDoMomento(a, chave, R);
    apagarRascunhoDoMomento(a, chave);
    expect(lerRascunhoDoMomento(a, chave)).toBeNull();
    expect(rascunhoEstaVazio(R)).toBe(false);
  });

  it("sem armazenamento, estragado ou com lixo, nunca lança e volta nulo", () => {
    expect(lerRascunhoDoMomento(null, "x")).toBeNull();
    gravarRascunhoDoMomento(null, "x", R);
    apagarRascunhoDoMomento(null, "x");
    const a = armazenamentoDeMemoria();
    a.dados.set("x", "{não é json");
    expect(lerRascunhoDoMomento(a, "x")).toBeNull();
    a.dados.set("x", '"texto"');
    expect(lerRascunhoDoMomento(a, "x")).toBeNull();
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("cheio"); }, removeItem: () => { throw new Error("bloqueado"); } };
    expect(lerRascunhoDoMomento(quebrado, "x")).toBeNull();
    expect(() => gravarRascunhoDoMomento(quebrado, "x", R)).not.toThrow();
    expect(() => apagarRascunhoDoMomento(quebrado, "x")).not.toThrow();
  });
});
