import { describe, expect, it } from "vitest";

import type { TemaDoDia } from "@/db/schema";

import type { VideoMedido } from "./desempenho-da-conta";
import { objetivoQueMaisRende, ordenarTemasPeloQueRende, VANTAGEM_MINIMA_ENTRE_OBJETIVOS } from "./ordem-dos-temas";

function video(parcial: Partial<VideoMedido> = {}): VideoMedido {
  return { multiplicador: 1, objetivo: "alcance", gancho: "cena", duracaoS: 30, hora: 19, ...parcial };
}

function varios(n: number, parcial: Partial<VideoMedido>): VideoMedido[] {
  return Array.from({ length: n }, () => video(parcial));
}

function tema(titulo: string, puxaPara: TemaDoDia["puxaPara"], extra: Partial<TemaDoDia> = {}): TemaDoDia {
  return { titulo, descricao: "d", porQue: "p", evidencias: [1], puxaPara, ...extra };
}

describe("objetivoQueMaisRende", () => {
  it("devolve o objetivo cuja mediana passa de 1,5 vez o normal da conta, com vantagem sobre o outro", () => {
    const videos = [...varios(4, { objetivo: "conversao", multiplicador: 3 }), ...varios(8, { objetivo: "alcance", multiplicador: 1 })];
    expect(objetivoQueMaisRende(videos)).toBe("conversao");
  });

  it("com menos de 8 vídeos medidos não conclui nada", () => {
    const videos = [...varios(3, { objetivo: "conversao", multiplicador: 5 }), ...varios(4, { objetivo: "alcance", multiplicador: 1 })];
    expect(videos).toHaveLength(7);
    expect(objetivoQueMaisRende(videos)).toBeNull();
    expect(objetivoQueMaisRende([])).toBeNull();
  });

  it("um objetivo com menos de 3 vídeos não elege nada, por mais que tenha rendido", () => {
    const videos = [...varios(2, { objetivo: "conversao", multiplicador: 9 }), ...varios(8, { objetivo: "alcance", multiplicador: 1 })];
    expect(objetivoQueMaisRende(videos)).toBeNull();
  });

  it("mediana abaixo de 1,5 vez não é 'claramente mais'", () => {
    const videos = [...varios(4, { objetivo: "engajamento", multiplicador: 1.4 }), ...varios(8, { objetivo: "alcance", multiplicador: 1 })];
    expect(objetivoQueMaisRende(videos)).toBeNull();
  });

  it("conta que só fez um objetivo não tem com o que comparar", () => {
    expect(objetivoQueMaisRende(varios(12, { objetivo: "alcance", multiplicador: 3 }))).toBeNull();
  });

  it("dois objetivos parecidos em cima empatam e ninguém sobe", () => {
    const videos = [
      ...varios(4, { objetivo: "conversao", multiplicador: 2.0 }),
      ...varios(4, { objetivo: "engajamento", multiplicador: 1.9 }),
      ...varios(4, { objetivo: "alcance", multiplicador: 0.5 }),
    ];
    expect(objetivoQueMaisRende(videos)).toBeNull();
  });

  it("dois objetivos acima do limiar, um com vantagem de verdade: o da frente", () => {
    const videos = [
      ...varios(4, { objetivo: "conversao", multiplicador: 4 }),
      ...varios(4, { objetivo: "engajamento", multiplicador: 4 / (VANTAGEM_MINIMA_ENTRE_OBJETIVOS + 0.1) }),
      ...varios(4, { objetivo: "alcance", multiplicador: 0.5 }),
    ];
    expect(objetivoQueMaisRende(videos)).toBe("conversao");
  });
});

describe("ordenarTemasPeloQueRende", () => {
  const temas = [tema("a", "alcance"), tema("b", "engajamento"), tema("c", "conversao")];

  it("sem objetivo devolve a mesma lista, na mesma ordem", () => {
    expect(ordenarTemasPeloQueRende(temas, null)).toBe(temas);
  });

  it("o tema que puxa para o objetivo sobe e os outros mantêm a ordem do setor", () => {
    expect(ordenarTemasPeloQueRende(temas, "conversao").map((t) => t.titulo)).toEqual(["c", "a", "b"]);
    expect(ordenarTemasPeloQueRende(temas, "engajamento").map((t) => t.titulo)).toEqual(["b", "a", "c"]);
  });

  it("vários temas do mesmo objetivo sobem juntos, na ordem em que estavam", () => {
    const lista = [tema("a", "alcance"), tema("b", "conversao"), tema("c", "alcance"), tema("d", "conversao")];
    expect(ordenarTemasPeloQueRende(lista, "conversao").map((t) => t.titulo)).toEqual(["b", "d", "a", "c"]);
  });

  it("nenhum tema do objetivo: a ordem não muda", () => {
    const lista = [tema("a", "alcance"), tema("b", "engajamento")];
    expect(ordenarTemasPeloQueRende(lista, "conversao").map((t) => t.titulo)).toEqual(["a", "b"]);
  });

  it("só reordena: o texto de cada tema continua o do setor e nada se perde nem se repete", () => {
    const resultado = ordenarTemasPeloQueRende(temas, "conversao");
    expect(resultado).toHaveLength(temas.length);
    for (const original of temas) expect(resultado).toContain(original);
  });

  it("o tema do momento fica no lugar dele; os do setor se arrumam nos lugares que sobram", () => {
    const momento = tema("m", "alcance", { doMomento: { chave: "x", assunto: "x", termos: [], fonte: "f", url: null, coletadaEm: "2026-10-23T00:00:00Z", encaixe: 9 } });
    const lista = [tema("a", "alcance"), momento, tema("c", "conversao"), tema("d", "engajamento")];
    expect(ordenarTemasPeloQueRende(lista, "conversao").map((t) => t.titulo)).toEqual(["c", "m", "a", "d"]);
  });

  it("não altera a lista de entrada", () => {
    const copia = temas.map((t) => t.titulo);
    ordenarTemasPeloQueRende(temas, "conversao");
    expect(temas.map((t) => t.titulo)).toEqual(copia);
  });
});
