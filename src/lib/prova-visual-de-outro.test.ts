/**
 * E59: o critério de quando a entrada liga a prova visual com imagem de outro (`R-ROTEIRO-20`).
 */
import { describe, expect, it } from "vitest";

import { frasesDosMotivos, motivosDaProvaVisualDeOutro, type DadosDaProvaVisual } from "./prova-visual-de-outro";

const BASE: DadosDaProvaVisual = {
  formato: "reels",
  estilo: "falado",
  ehMomento: false,
  tema: "o erro que faz a mancha de vinho espalhar no sofá",
  temNoticia: false,
  temNoticiasDoAssunto: false,
  analisesVisuais: [],
};

const analise = (recursos: string[], extra: { cenario?: string; oQue?: string } = {}) => ({
  recursos,
  cenario: extra.cenario ?? "sala de estar",
  textoNaTela: extra.oQue ? [{ quando: "0:01", onde: "centro", oQue: extra.oQue }] : [],
  momentoChave: null,
});

describe("motivosDaProvaVisualDeOutro", () => {
  it("tema comum e sem recurso no banco: não sugere", () => {
    expect(motivosDaProvaVisualDeOutro(BASE)).toEqual([]);
  });

  it("o banco mostra tela dividida, reação ou recorte de notícia nos vídeos do ramo: liga pelo banco", () => {
    expect(motivosDaProvaVisualDeOutro({ ...BASE, analisesVisuais: [analise(["tela dividida com a pessoa reagindo"])] })).toEqual(["banco"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, analisesVisuais: [null, analise([], { oQue: "print de notícia na tela" })] })).toEqual(["banco"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, analisesVisuais: [analise(["Split Screen"])] })).toEqual(["banco"]);
  });

  it("antes e depois do próprio trabalho e foto do próprio produto não contam como imagem de outro", () => {
    expect(motivosDaProvaVisualDeOutro({ ...BASE, analisesVisuais: [analise(["antes e depois lado a lado", "close no resultado"], { oQue: "foto do produto" })] })).toEqual([]);
  });

  it("o tema cita pessoa pública pelo papel ou pelo cargo", () => {
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema: "comparar o que dois deputados prometeram" })).toEqual(["pessoa_publica"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema: "o que a eleição muda para quem tem loja" })).toEqual(["pessoa_publica"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema: "o cantor famoso usou o nosso tipo de produto?" })).toEqual(["pessoa_publica"]);
  });

  it("o tema comenta uma fala pública ou uma notícia", () => {
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema: "a declaração polêmica sobre o preço do aluguel" })).toEqual(["fala_publica"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema: "a lei nova que muda a nota fiscal do pequeno comércio" })).toEqual(["noticia"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, temNoticia: true })).toEqual(["noticia"]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, temNoticiasDoAssunto: true })).toEqual(["noticia"]);
  });

  it("o objetivo do vídeo conta como parte do tema", () => {
    expect(motivosDaProvaVisualDeOutro({ ...BASE, objetivoDoVideo: "reagir ao discurso do ministro" })).toEqual(["pessoa_publica", "fala_publica"]);
  });

  it("junta os motivos, na ordem: banco, pessoa, fala, notícia", () => {
    const motivos = motivosDaProvaVisualDeOutro({
      ...BASE,
      tema: "o deputado e a declaração sobre a lei nova",
      analisesVisuais: [analise(["reação em tela dividida"])],
    });
    expect(motivos).toEqual(["banco", "pessoa_publica", "fala_publica", "noticia"]);
  });

  it("só no Reels falado: Story, sem fala e o momento nunca ligam", () => {
    const tema = "comparar o que dois deputados disseram";
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema, formato: "story" })).toEqual([]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema, estilo: "sem_fala" })).toEqual([]);
    expect(motivosDaProvaVisualDeOutro({ ...BASE, tema, ehMomento: true })).toEqual([]);
  });
});

describe("frasesDosMotivos", () => {
  it("um motivo, dois e três", () => {
    expect(frasesDosMotivos(["pessoa_publica"])).toBe("o tema cita uma pessoa pública");
    expect(frasesDosMotivos(["pessoa_publica", "noticia"])).toBe("o tema cita uma pessoa pública; e o tema vem de uma notícia");
    expect(frasesDosMotivos([])).toBe("");
  });
});
