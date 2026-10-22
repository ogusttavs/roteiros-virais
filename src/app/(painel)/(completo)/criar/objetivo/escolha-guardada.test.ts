import { describe, expect, it } from "vitest";

import { chaveDaEscolha, gravarEscolha, lerEscolha, type EscolhaGuardada } from "./escolha-guardada";

function armazenamentoFalso() {
  const dados = new Map<string, string>();
  return { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v), dados };
}

const ESCOLHA: EscolhaGuardada = {
  ficha: "guardem",
  compacta: true,
  formato: "reels",
  estilo: "sem_fala",
  estiloTocado: true,
  objetivoDoVideo: "o horário mudou",
  quemAparece: "equipe",
  data: "2026-10-30",
  momentoDoDia: null,
};

describe("a escolha do passo do objetivo guardada por tema", () => {
  it("o que se grava volta igual; o estilo só volta se a pessoa mexeu nele", () => {
    const a = armazenamentoFalso();
    const chave = chaveDaEscolha(["livre", "como lavar o sofá", null, null, null, null, null]);
    gravarEscolha(chave, ESCOLHA, a);
    expect(lerEscolha(chave, "2026-10-22", a)).toEqual({
      ficha: "guardem",
      compacta: true,
      formato: "reels",
      estilo: "sem_fala",
      estiloTocado: true,
      objetivoDoVideo: "o horário mudou",
      quemAparece: "equipe",
      data: "2026-10-30",
    });
    gravarEscolha(chave, { ...ESCOLHA, estiloTocado: false }, a);
    expect(lerEscolha(chave, "2026-10-22", a)).not.toHaveProperty("estilo");
  });

  it("temas diferentes têm escolhas diferentes", () => {
    const a = armazenamentoFalso();
    gravarEscolha(chaveDaEscolha(["sugerido", "tema um"]), ESCOLHA, a);
    expect(lerEscolha(chaveDaEscolha(["sugerido", "tema dois"]), "2026-10-22", a)).toBeNull();
  });

  it("um dia que já passou não volta, e valor fora das listas é descartado", () => {
    const a = armazenamentoFalso();
    const chave = chaveDaEscolha(["livre", "x"]);
    a.setItem(chave, JSON.stringify({ ficha: "outra-coisa", formato: "filme", quemAparece: "alguem", data: "2026-10-01", momentoDoDia: "madrugada", objetivoDoVideo: "ok" }));
    expect(lerEscolha(chave, "2026-10-22", a)).toEqual({ objetivoDoVideo: "ok" });
  });

  it("texto que não é JSON, e armazenamento ausente ou que lança, valem como sem escolha", () => {
    const a = armazenamentoFalso();
    const chave = chaveDaEscolha(["livre", "x"]);
    a.setItem(chave, "{não é json");
    expect(lerEscolha(chave, "2026-10-22", a)).toBeNull();
    expect(lerEscolha(chave, "2026-10-22", null)).toBeNull();
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(lerEscolha(chave, "2026-10-22", quebrado)).toBeNull();
    expect(() => gravarEscolha(chave, ESCOLHA, quebrado)).not.toThrow();
  });
});
