import { describe, expect, it } from "vitest";

import type { TemaDoDia } from "@/db/schema";

import { completarComOSetor, hashDoFoco, hashDosCandidatos } from "./temas-da-conta";

const tema = (titulo: string, evidencias: number[] = [1], extra: Partial<TemaDoDia> = {}): TemaDoDia => ({
  titulo,
  descricao: "descricao",
  porQue: "por que",
  evidencias,
  puxaPara: "alcance",
  ...extra,
});

describe("hashDoFoco", () => {
  it("o mesmo foco, com outra caixa ou espaço sobrando, dá o mesmo hash; outro foco, outro hash", () => {
    expect(hashDoFoco("Marketing e automação com IA")).toBe(hashDoFoco("  marketing  e automação com ia "));
    expect(hashDoFoco("Marketing e automação com IA")).not.toBe(hashDoFoco("Posicionamento pessoal"));
  });
});

describe("hashDosCandidatos", () => {
  it("não depende da ordem e muda quando chega vídeo novo ou o setor troca de tema", () => {
    expect(hashDosCandidatos([3, 1, 2], ["b", "a"])).toBe(hashDosCandidatos([1, 2, 3], ["a", "b"]));
    expect(hashDosCandidatos([1, 2, 3], ["a"])).not.toBe(hashDosCandidatos([1, 2, 3, 4], ["a"]));
    expect(hashDosCandidatos([1, 2, 3], ["a"])).not.toBe(hashDosCandidatos([1, 2, 3], ["outro"]));
  });
});

describe("completarComOSetor", () => {
  const setor = [tema("setor 1", [10]), tema("setor 2", [20]), tema("setor 3", [30])];

  it("três temas do foco: nada do setor entra", () => {
    const proprios = [tema("foco 1"), tema("foco 2"), tema("foco 3")];
    expect(completarComOSetor(proprios, setor, new Set())).toEqual(proprios);
  });

  it("sem tema do foco, devolve vazio: a conta lê exatamente os temas do setor, sem cópia", () => {
    expect(completarComOSetor([], setor, new Set([10]))).toEqual([]);
  });

  it("completa até três com os do setor marcados doSetor, os próximos do foco primeiro", () => {
    const resultado = completarComOSetor([tema("foco 1")], setor, new Set([30]));
    expect(resultado.map((t) => t.titulo)).toEqual(["foco 1", "setor 3", "setor 1"]);
    expect(resultado[0].doSetor).toBeUndefined();
    expect(resultado.slice(1).every((t) => t.doSetor === true)).toBe(true);
  });

  it("não repete título, mesmo com outra acentuação, e nunca copia o tema do momento", () => {
    const doSetor = [tema("Setor 1"), tema("Em alta", [5], { doMomento: { chave: "x", assunto: "x", termos: [], fonte: "f", url: null, coletadaEm: "2026-10-28T00:00:00Z", encaixe: 9 } }), tema("setor 2")];
    const resultado = completarComOSetor([tema("setor 1")], doSetor, new Set());
    expect(resultado.map((t) => t.titulo)).toEqual(["setor 1", "setor 2"]);
  });

  it("não muda a lista que recebeu", () => {
    const proprios = [tema("foco 1")];
    completarComOSetor(proprios, setor, new Set());
    expect(proprios).toHaveLength(1);
    expect(setor.every((t) => t.doSetor === undefined)).toBe(true);
  });
});
