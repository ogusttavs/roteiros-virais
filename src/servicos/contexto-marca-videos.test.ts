import { describe, expect, it } from "vitest";

import { resumirVideosParaIA } from "./contexto-marca-regras";

describe("resumirVideosParaIA: o que rendeu é conta feita em código", () => {
  const views = [1000, 1200, 900, 1100, 5500, 1000];

  it("calcula a mediana do perfil e quantas vezes cada vídeo passa dela", () => {
    const resultado = resumirVideosParaIA(views.map((v, i) => ({ titulo: `Vídeo ${i + 1}`, views: v })));
    // mediana de [900, 1000, 1000, 1100, 1200, 5500] = 1050
    expect(resultado.medianaVisualizacoes).toBe(1050);
    expect(resultado.videos[4]).toEqual({ titulo: "Vídeo 5", visualizacoes: 5500, vezesAMediana: 5.2 });
    expect(resultado.videos[0].vezesAMediana).toBe(1);
  });

  it("com menos de 5 vídeos com visualização não há mediana nem múltiplo", () => {
    const resultado = resumirVideosParaIA([
      { titulo: "A", views: 100 },
      { titulo: "B", views: 200 },
      { titulo: "C", views: null },
    ]);
    expect(resultado.medianaVisualizacoes).toBeNull();
    expect(resultado.videos.every((v) => v.vezesAMediana === null)).toBe(true);
    expect(resultado.videos[0].visualizacoes).toBe(100);
  });

  it("ignora vídeo sem título, limpa marcação e limita a quinze", () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      titulo: i === 0 ? null : `<b>Título ${i}</b>`,
      views: 100 + i,
    }));
    const resultado = resumirVideosParaIA(muitos);
    expect(resultado.videos).toHaveLength(15);
    expect(resultado.videos[0].titulo).toBe("Título 1");
  });

  it("mediana zero não gera divisão por zero", () => {
    const resultado = resumirVideosParaIA([0, 0, 0, 0, 0, 40].map((v, i) => ({ titulo: `V${i}`, views: v })));
    expect(resultado.medianaVisualizacoes).toBe(0);
    expect(resultado.videos.every((v) => v.vezesAMediana === null)).toBe(true);
  });

  describe("fronteiras das constantes de produto", () => {
    const video = (indice: number, views: number | null) => ({ titulo: `Vídeo ${indice}`, views });

    it("quatro vídeos com visualização não dão mediana; cinco, sim", () => {
      expect(resumirVideosParaIA([1, 2, 3, 4].map((v, i) => video(i, v * 100))).medianaVisualizacoes).toBeNull();
      expect(resumirVideosParaIA([1, 2, 3, 4, 5].map((v, i) => video(i, v * 100))).medianaVisualizacoes).toBe(300);
    });

    it("só contam os vídeos COM visualização: cinco vídeos, um sem número, são quatro", () => {
      const resultado = resumirVideosParaIA([video(1, 100), video(2, 200), video(3, 300), video(4, 400), video(5, null)]);
      expect(resultado.medianaVisualizacoes).toBeNull();
    });

    it("visualização negativa (dado ruim) não entra na conta", () => {
      const resultado = resumirVideosParaIA([video(1, 100), video(2, 100), video(3, 100), video(4, 100), video(5, -50)]);
      expect(resultado.medianaVisualizacoes).toBeNull();
    });

    it("mediana de quantidade par é a média dos dois do meio, arredondada para número inteiro", () => {
      // [100, 100, 101, 102, 200, 300]: meio = (101 + 102) / 2 = 101,5 -> 102
      const resultado = resumirVideosParaIA([100, 100, 101, 102, 200, 300].map((v, i) => video(i, v)));
      expect(resultado.medianaVisualizacoes).toBe(102);
    });

    it("o título passa de 140 caracteres: é cortado nos 140", () => {
      const resultado = resumirVideosParaIA([{ titulo: "a".repeat(200), views: 10 }]);
      expect(resultado.videos[0].titulo).toHaveLength(140);
    });

    it("quinze vídeos entram, o décimo sexto não", () => {
      const resultado = resumirVideosParaIA(Array.from({ length: 16 }, (_, i) => video(i, 100 + i)));
      expect(resultado.videos).toHaveLength(15);
      expect(resultado.videos[14].titulo).toBe("Vídeo 14");
    });

    it("o múltiplo vem com uma casa depois da vírgula", () => {
      // mediana 100; o vídeo de 333 views passa 3,33 vezes -> 3,3
      const resultado = resumirVideosParaIA([100, 100, 100, 100, 100, 333].map((v, i) => video(i, v)));
      expect(resultado.videos[5].vezesAMediana).toBe(3.3);
    });
  });
});
