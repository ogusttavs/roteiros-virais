import { describe, expect, it } from "vitest";

import { limitarPorConta, selecionarParaTranscrever, type VideoParaSelecionar } from "./selecionar-transcricao";

const AGORA = new Date("2026-09-03T12:00:00Z");
/** Sem restricao de verdade nestes testes (todo candidato default e "pt"): so passa o parametro adiante. */
const PROPORCAO_PADRAO = 0.7;

function candidato(id: number, opcoes: Partial<VideoParaSelecionar> = {}): VideoParaSelecionar {
  return {
    id,
    contaId: null,
    temTranscricao: false,
    proximaTentativaTranscricao: null,
    idioma: "pt",
    contaBrasileira: true,
    ...opcoes,
  };
}

describe("selecionarParaTranscrever", () => {
  it("prioriza subindo hoje sobre fora da curva", () => {
    const candidatos = [candidato(1), candidato(2), candidato(3)];
    const selecionados = selecionarParaTranscrever([2], [1, 3], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([2, 1, 3]);
  });

  it("nao duplica video que aparece nas duas listas", () => {
    const candidatos = [candidato(1), candidato(2)];
    const selecionados = selecionarParaTranscrever([1, 2], [1], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([1, 2]);
  });

  it("respeita o limite", () => {
    const candidatos = [candidato(1), candidato(2), candidato(3)];
    const selecionados = selecionarParaTranscrever([1, 2, 3], [], candidatos, 2, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([1, 2]);
  });

  it("pula video que ja tem transcricao", () => {
    const candidatos = [candidato(1, { temTranscricao: true }), candidato(2)];
    const selecionados = selecionarParaTranscrever([1, 2], [], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([2]);
  });

  it("pula video com tentativa futura marcada, mas aceita tentativa ja passada", () => {
    const futuro = new Date(AGORA.getTime() + 24 * 60 * 60 * 1000);
    const passado = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    const candidatos = [
      candidato(1, { proximaTentativaTranscricao: futuro }),
      candidato(2, { proximaTentativaTranscricao: passado }),
    ];
    const selecionados = selecionarParaTranscrever([1, 2], [], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([2]);
  });

  it("ignora id que nao esta na lista de candidatos (sem metadado, nao seleciona)", () => {
    const candidatos = [candidato(1)];
    const selecionados = selecionarParaTranscrever([1, 99], [], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([1]);
  });

  it("sem candidato nenhum, devolve lista vazia", () => {
    expect(selecionarParaTranscrever([], [], [], 10, AGORA, PROPORCAO_PADRAO)).toEqual([]);
  });

  /** V2a, item 2: nunca mais de 2 vídeos da mesma conta na fila final. */
  it("no maximo 2 videos da mesma conta, os de maior prioridade ficam", () => {
    const candidatos = [
      candidato(1, { contaId: 100 }),
      candidato(2, { contaId: 100 }),
      candidato(3, { contaId: 100 }),
      candidato(4, { contaId: 200 }),
    ];
    const selecionados = selecionarParaTranscrever([1, 2, 3, 4], [], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([1, 2, 4]);
  });

  it("video sem dono (contaId nulo) nunca entra no teto por conta, mesmo em quantidade", () => {
    const candidatos = [
      candidato(1, { contaId: null }),
      candidato(2, { contaId: null }),
      candidato(3, { contaId: null }),
    ];
    const selecionados = selecionarParaTranscrever([1, 2, 3], [], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([1, 2, 3]);
  });

  /** V2b, item 6: a proporcao 70/30 corta depois do teto por conta, antes do corte final por limite. */
  it("aplica a proporcao 70/30, cortando so o internacional excedente", () => {
    const candidatos = [
      candidato(1, { idioma: "en" }),
      candidato(2, { idioma: "pt" }),
      candidato(3, { idioma: "en" }),
      candidato(4, { idioma: "en" }), // excedente: limite 10, max internacional = 3... aqui so ha 3 no total
      candidato(5, { idioma: "outro" }), // nunca entra
    ];
    const selecionados = selecionarParaTranscrever([1, 2, 3, 4, 5], [], candidatos, 10, AGORA, PROPORCAO_PADRAO);
    expect(selecionados).toEqual([1, 2, 3, 4]);
  });
});

describe("limitarPorConta", () => {
  it("corta na terceira aparicao da mesma conta, mantendo as duas primeiras", () => {
    const contaPorId = new Map([
      [1, 10],
      [2, 10],
      [3, 10],
      [4, 20],
    ]);
    expect(limitarPorConta([1, 2, 3, 4], contaPorId, 2)).toEqual([1, 2, 4]);
  });

  it("video sem dono (contaId nulo no mapa, ou ausente) nunca e cortado", () => {
    const contaPorId = new Map<number, number | null>([[1, null]]);
    expect(limitarPorConta([1, 2, 3], contaPorId, 1)).toEqual([1, 2, 3]);
  });

  it("respeita a ordem de prioridade da lista de entrada, nao reordena", () => {
    const contaPorId = new Map([
      [5, 10],
      [1, 10],
      [3, 10],
    ]);
    expect(limitarPorConta([5, 1, 3], contaPorId, 2)).toEqual([5, 1]);
  });

  it("maxPorConta zero nunca deixa passar conta nenhuma com dono", () => {
    const contaPorId = new Map([[1, 10]]);
    expect(limitarPorConta([1], contaPorId, 0)).toEqual([]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(limitarPorConta([], new Map(), 2)).toEqual([]);
  });
});
