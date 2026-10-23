import { describe, expect, it } from "vitest";

import { DIMENSOES_DO_VETOR } from "@/db/schema";

import {
  criarPortaDaVoyage,
  criarPortaSimulada,
  ErroEmbeddings,
  estimarTokens,
  hashDaFicha,
  lerRespostaDaVoyage,
  MODELO_SIMULADO,
  palavrasDoTexto,
  portaEmbeddings,
  vetorSimulado,
} from "./embeddings";

function cosseno(a: number[], b: number[]): number {
  return a.reduce((soma, x, i) => soma + x * b[i], 0);
}

describe("a porta simulada", () => {
  it("e determinista: o mesmo texto da sempre o mesmo vetor, de 1024 posicoes e tamanho 1", () => {
    const a = vetorSimulado("clareamento dental caseiro");
    const b = vetorSimulado("clareamento dental caseiro");
    expect(a).toEqual(b);
    expect(a).toHaveLength(DIMENSOES_DO_VETOR);
    expect(Math.sqrt(a.reduce((soma, x) => soma + x * x, 0))).toBeCloseTo(1, 10);
  });

  it("ignora acento, caixa e pontuacao", () => {
    expect(vetorSimulado("Clareamento, DENTAL!")).toEqual(vetorSimulado("clareamento dental"));
    expect(palavrasDoTexto("Ação rápida: já")).toEqual(["acao", "rapida"]);
  });

  it("textos com palavras em comum ficam mais perto que textos sem nada em comum", () => {
    const tema = vetorSimulado("tirar mancha do dente");
    const parecido = vetorSimulado("mancha no dente: como tirar de casa");
    const longe = vetorSimulado("receita de bolo de cenoura");
    expect(cosseno(tema, parecido)).toBeGreaterThan(cosseno(tema, longe));
    expect(cosseno(tema, parecido)).toBeGreaterThan(0.5);
  });

  it("palavras da mesma familia (clareamento, clareando) ficam perto pela raiz", () => {
    expect(cosseno(vetorSimulado("clareamento"), vetorSimulado("clareando"))).toBeGreaterThan(cosseno(vetorSimulado("clareamento"), vetorSimulado("cenoura")));
  });

  it("texto sem palavra nenhuma nunca vira vetor zerado", () => {
    const v = vetorSimulado("!!! ?? 1 2");
    expect(Math.sqrt(v.reduce((soma, x) => soma + x * x, 0))).toBeCloseTo(1, 10);
  });

  it("embedar devolve um vetor por texto, na ordem, e uma estimativa de tokens", async () => {
    const porta = criarPortaSimulada();
    expect(porta.simulada).toBe(true);
    expect(porta.modelo).toBe(MODELO_SIMULADO);
    const r = await porta.embedar(["um texto", "outro texto maior que o primeiro"], "documento");
    expect(r.vetores).toHaveLength(2);
    expect(r.vetores[0]).toEqual(vetorSimulado("um texto"));
    expect(r.tokens).toBe(estimarTokens("um texto") + estimarTokens("outro texto maior que o primeiro"));
  });

  it("nos testes a porta escolhida pela configuracao e a simulada", () => {
    expect(portaEmbeddings().simulada).toBe(true);
  });
});

describe("a porta da Voyage", () => {
  it("recusa existir dentro do Vitest, mesmo com chave", () => {
    expect(() => criarPortaDaVoyage("pa-qualquer", "voyage-3.5")).toThrow(/Vitest/);
  });
});

describe("lerRespostaDaVoyage (o que chega ao banco passa por aqui)", () => {
  const vetorBom = () => new Array<number>(DIMENSOES_DO_VETOR).fill(0.01);

  it("aceita a resposta certa e devolve na ordem do indice, com os tokens cobrados", () => {
    const a = vetorBom();
    const b = vetorBom().map((x) => x * 2);
    const r = lerRespostaDaVoyage({ data: [{ embedding: b, index: 1 }, { embedding: a, index: 0 }], usage: { total_tokens: 42 } }, 2);
    expect(r.vetores).toEqual([a, b]);
    expect(r.tokens).toBe(42);
  });

  it("recusa quantidade errada, dimensao errada e numero estranho", () => {
    expect(() => lerRespostaDaVoyage({ data: [{ embedding: vetorBom(), index: 0 }] }, 2)).toThrow(ErroEmbeddings);
    expect(() => lerRespostaDaVoyage({ data: [{ embedding: [1, 2, 3], index: 0 }] }, 1)).toThrow(/dimensao/);
    expect(() => lerRespostaDaVoyage({ data: [{ embedding: vetorBom().map((_, i) => (i === 0 ? Number.NaN : 0)), index: 0 }] }, 1)).toThrow(ErroEmbeddings);
    expect(() => lerRespostaDaVoyage({}, 1)).toThrow(ErroEmbeddings);
  });
});

describe("hashDaFicha", () => {
  it("muda com o texto e com o modelo, e e estavel", () => {
    expect(hashDaFicha("a", "m1")).toBe(hashDaFicha("a", "m1"));
    expect(hashDaFicha("a", "m1")).not.toBe(hashDaFicha("b", "m1"));
    expect(hashDaFicha("a", "m1")).not.toBe(hashDaFicha("a", "m2"));
  });
});
