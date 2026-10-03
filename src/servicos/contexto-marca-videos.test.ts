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
});
