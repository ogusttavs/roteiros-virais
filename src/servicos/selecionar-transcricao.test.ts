import { describe, expect, it } from "vitest";

import { selecionarParaTranscrever, type VideoParaSelecionar } from "./selecionar-transcricao";

const AGORA = new Date("2026-09-03T12:00:00Z");

function candidato(id: number, opcoes: Partial<VideoParaSelecionar> = {}): VideoParaSelecionar {
  return { id, temTranscricao: false, proximaTentativaTranscricao: null, ...opcoes };
}

describe("selecionarParaTranscrever", () => {
  it("prioriza subindo hoje sobre fora da curva", () => {
    const candidatos = [candidato(1), candidato(2), candidato(3)];
    const selecionados = selecionarParaTranscrever([2], [1, 3], candidatos, 10, AGORA);
    expect(selecionados).toEqual([2, 1, 3]);
  });

  it("nao duplica video que aparece nas duas listas", () => {
    const candidatos = [candidato(1), candidato(2)];
    const selecionados = selecionarParaTranscrever([1, 2], [1], candidatos, 10, AGORA);
    expect(selecionados).toEqual([1, 2]);
  });

  it("respeita o limite", () => {
    const candidatos = [candidato(1), candidato(2), candidato(3)];
    const selecionados = selecionarParaTranscrever([1, 2, 3], [], candidatos, 2, AGORA);
    expect(selecionados).toEqual([1, 2]);
  });

  it("pula video que ja tem transcricao", () => {
    const candidatos = [candidato(1, { temTranscricao: true }), candidato(2)];
    const selecionados = selecionarParaTranscrever([1, 2], [], candidatos, 10, AGORA);
    expect(selecionados).toEqual([2]);
  });

  it("pula video com tentativa futura marcada, mas aceita tentativa ja passada", () => {
    const futuro = new Date(AGORA.getTime() + 24 * 60 * 60 * 1000);
    const passado = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    const candidatos = [
      candidato(1, { proximaTentativaTranscricao: futuro }),
      candidato(2, { proximaTentativaTranscricao: passado }),
    ];
    const selecionados = selecionarParaTranscrever([1, 2], [], candidatos, 10, AGORA);
    expect(selecionados).toEqual([2]);
  });

  it("ignora id que nao esta na lista de candidatos (sem metadado, nao seleciona)", () => {
    const candidatos = [candidato(1)];
    const selecionados = selecionarParaTranscrever([1, 99], [], candidatos, 10, AGORA);
    expect(selecionados).toEqual([1]);
  });

  it("sem candidato nenhum, devolve lista vazia", () => {
    expect(selecionarParaTranscrever([], [], [], 10, AGORA)).toEqual([]);
  });
});
