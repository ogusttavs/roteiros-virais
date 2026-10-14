import { describe, expect, it } from "vitest";

import type { AnaliseVideoLonga } from "@/db/schema";

import { capituloQueInteressa } from "./capitulo-de-referencia";

function analise(entregaAteS: number | null, capitulos: { inicioS: number; nome: string }[], promessa = "mostra o resultado"): AnaliseVideoLonga {
  return {
    versaoPrompt: "1.0.0",
    origemDosCapitulos: "descricao",
    assunto: "x",
    abertura: { promessa, entregaAteS, tipo: "resultado" },
    capitulos: capitulos.map((c) => ({ ...c, oQueFaz: "", gancho: null })),
    lacos: [],
    ondeSairia: [{ segundo: 10, porQue: "x" }],
    fechamento: { oQueFaz: "", apontaParaProximoVideo: false },
    porQueFuncionou: "x",
  };
}

const CAPS = [
  { inicioS: 0, nome: "Abertura" },
  { inicioS: 60, nome: "Primeiro erro" },
  { inicioS: 180, nome: "Segundo erro" },
];

describe("capituloQueInteressa", () => {
  it("é o capítulo que contém o segundo em que a abertura entrega, com o fim no começo do próximo e a promessa", () => {
    expect(capituloQueInteressa(analise(100, CAPS), 600)).toEqual({ inicioS: 60, fimS: 180, nome: "Primeiro erro", promessa: "mostra o resultado" });
  });

  it("o último capítulo termina na duração do vídeo", () => {
    expect(capituloQueInteressa(analise(400, CAPS), 600)).toEqual({ inicioS: 180, fimS: 600, nome: "Segundo erro", promessa: "mostra o resultado" });
  });

  it("no segundo exato em que um capítulo começa, ele é o capítulo (a borda é do que começa)", () => {
    expect(capituloQueInteressa(analise(60, CAPS), 600)?.nome).toBe("Primeiro erro");
    expect(capituloQueInteressa(analise(0, CAPS), 600)?.nome).toBe("Abertura");
  });

  it("sem leitura, com a abertura que não entrega ou sem capítulos lidos, não há capítulo", () => {
    expect(capituloQueInteressa(null, 600)).toBeNull();
    expect(capituloQueInteressa(undefined, 600)).toBeNull();
    expect(capituloQueInteressa(analise(null, CAPS), 600)).toBeNull();
    expect(capituloQueInteressa(analise(100, []), 600)).toBeNull();
  });

  it("o segundo de entrega fora do vídeo (negativo, além da duração, não numérico) não dá capítulo", () => {
    expect(capituloQueInteressa(analise(-5, CAPS), 600)).toBeNull();
    expect(capituloQueInteressa(analise(601, CAPS), 600)).toBeNull();
    expect(capituloQueInteressa(analise(Number.NaN, CAPS), 600)).toBeNull();
  });

  it("a lista que não abre em 0:00 não inventa capítulo para o segundo anterior ao primeiro", () => {
    expect(capituloQueInteressa(analise(10, [{ inicioS: 30, nome: "Começo tardio" }, { inicioS: 90, nome: "Meio" }]), 600)).toBeNull();
  });

  it("ignora capítulo fora do vídeo, aceita a lista fora de ordem e recusa nome vazio", () => {
    expect(capituloQueInteressa(analise(100, [{ inicioS: 180, nome: "Segundo erro" }, { inicioS: 0, nome: "Abertura" }, { inicioS: 900, nome: "Fora do vídeo" }, { inicioS: 60, nome: "Primeiro erro" }]), 600)).toEqual({
      inicioS: 60,
      fimS: 180,
      nome: "Primeiro erro",
      promessa: "mostra o resultado",
    });
    expect(capituloQueInteressa(analise(10, [{ inicioS: 0, nome: "   " }]), 600)).toBeNull();
  });

  it("limpa os espaços do nome e da promessa", () => {
    expect(capituloQueInteressa(analise(10, [{ inicioS: 0, nome: "  O   teste  " }], "  mostra   tudo "), 600)).toEqual({ inicioS: 0, fimS: 600, nome: "O teste", promessa: "mostra tudo" });
  });
});
