import { describe, expect, it } from "vitest";

import { contarAudiosDaSemana, type VideoComAudio } from "./audio-da-semana";

describe("contarAudiosDaSemana", () => {
  it("conta por id de audio e devolve os tres mais frequentes, do mais para o menos usado", () => {
    const videos: VideoComAudio[] = [
      { id: 1, audio: { id: "a", nome: "audio A", autor: "criador A" } },
      { id: 2, audio: { id: "a", nome: "audio A", autor: "criador A" } },
      { id: 3, audio: { id: "a", nome: "audio A", autor: "criador A" } },
      { id: 4, audio: { id: "b", nome: "audio B", autor: "criador B" } },
      { id: 5, audio: { id: "b", nome: "audio B", autor: "criador B" } },
      { id: 6, audio: { id: "c", nome: "audio C", autor: "criador C" } },
      { id: 7, audio: { id: "d", nome: "audio D", autor: "criador D" } },
    ];

    const resultado = contarAudiosDaSemana(videos);
    expect(resultado).toHaveLength(3);
    expect(resultado[0]).toMatchObject({ nome: "audio A", contagem: 3, videoExemploId: 1 });
    expect(resultado[1]).toMatchObject({ nome: "audio B", contagem: 2, videoExemploId: 4 });
    expect(resultado[2].contagem).toBe(1);
  });

  it("video sem audio (youtube, ou tiktok/instagram sem audio identificado) nao entra na contagem", () => {
    const videos: VideoComAudio[] = [
      { id: 1, audio: null },
      { id: 2, audio: { id: "a", nome: "audio A" } },
      { id: 3, audio: {} },
    ];

    const resultado = contarAudiosDaSemana(videos);
    expect(resultado).toEqual([{ nome: "audio A", autor: null, contagem: 1, videoExemploId: 2 }]);
  });

  it("empate na contagem desempata pelo id do video de exemplo, do menor para o maior", () => {
    const videos: VideoComAudio[] = [
      { id: 10, audio: { id: "y", nome: "audio Y" } },
      { id: 5, audio: { id: "x", nome: "audio X" } },
    ];

    const resultado = contarAudiosDaSemana(videos);
    expect(resultado.map((r) => r.nome)).toEqual(["audio X", "audio Y"]);
  });

  it("sem video nenhum, devolve lista vazia", () => {
    expect(contarAudiosDaSemana([])).toEqual([]);
  });

  it("agrupa pelo nome quando o audio nao tem id (so acontece se a coleta nao trouxer id)", () => {
    const videos: VideoComAudio[] = [
      { id: 1, audio: { nome: "audio sem id" } },
      { id: 2, audio: { nome: "audio sem id" } },
    ];

    const resultado = contarAudiosDaSemana(videos);
    expect(resultado).toEqual([{ nome: "audio sem id", autor: null, contagem: 2, videoExemploId: 1 }]);
  });
});
