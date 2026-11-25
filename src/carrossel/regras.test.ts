import { describe, expect, it } from "vitest";

import { ajustarAosLimites, normalizarHashtags, verificarLegenda, verificarLimitesDosSlides, verificarOrdemDosSlides, type SlideDaIA } from "./regras";

const s = (tipo: SlideDaIA["tipo"], titulo = "Um título curto", corpo = "Um texto curto aqui", fonte: string | null = null): SlideDaIA => ({ tipo, titulo, corpo, fonte });

describe("verificarOrdemDosSlides", () => {
  it("aceita capa, meio misturado e chamada", () => {
    expect(verificarOrdemDosSlides([s("capa-texto"), s("passo"), s("item"), s("passo"), s("chamada")], 5)).toEqual([]);
  });
  it("reprova quantidade errada, capa fora do lugar e chamada fora do lugar", () => {
    expect(verificarOrdemDosSlides([s("passo"), s("capa-texto"), s("chamada"), s("item")], 5).join("|")).toMatch(/4 slides.*5/);
    const m = verificarOrdemDosSlides([s("passo"), s("capa-texto"), s("chamada"), s("item")], 4).join("|");
    expect(m).toMatch(/primeiro slide/);
    expect(m).toMatch(/último slide/);
    expect(m).toMatch(/"capa-texto" só pode ser o primeiro/);
    expect(m).toMatch(/"chamada" só pode ser o último/);
  });
  it("aceita dois seguidos e reprova três seguidos do mesmo tipo", () => {
    expect(verificarOrdemDosSlides([s("capa-texto"), s("item"), s("item"), s("passo"), s("chamada")], 5)).toEqual([]);
    expect(verificarOrdemDosSlides([s("capa-texto"), s("item"), s("item"), s("item"), s("chamada")], 5).join("|")).toMatch(/3 slides seguidos do tipo "item"/);
  });
});

describe("verificarLimitesDosSlides", () => {
  const palavras = (n: number) => Array.from({ length: n }, () => "ok").join(" ");
  it("reprova título e texto acima do limite do tipo, no limite aprova", () => {
    expect(verificarLimitesDosSlides([s("passo", palavras(8), palavras(30))], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("passo", palavras(9), palavras(30))], { ramoSaude: false }).join()).toMatch(/título com 9 palavras/);
    expect(verificarLimitesDosSlides([s("passo", palavras(8), palavras(31))], { ramoSaude: false }).join()).toMatch(/texto com 31 palavras/);
  });
  it("o limite muda com o tipo", () => {
    expect(verificarLimitesDosSlides([s("capa-texto", palavras(12), palavras(14))], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("resumo", palavras(6), palavras(35))], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("chamada", palavras(10), palavras(21))], { ramoSaude: false }).join()).toMatch(/limite é 20/);
  });
  it("dado exige fonte com ano e número; os outros tipos não levam fonte", () => {
    expect(verificarLimitesDosSlides([s("dado", "42% erram", "Segundo a pesquisa", "Sebrae, 2025")], { ramoSaude: false })).toEqual([]);
    expect(verificarLimitesDosSlides([s("dado", "42% erram", "x", null)], { ramoSaude: false }).join()).toMatch(/sem a fonte/);
    expect(verificarLimitesDosSlides([s("dado", "42% erram", "x", "Sebrae")], { ramoSaude: false }).join()).toMatch(/precisa ter o ano/);
    expect(verificarLimitesDosSlides([s("dado", "muita gente erra", "x", "Sebrae, 2025")], { ramoSaude: false }).join()).toMatch(/tem número/);
    expect(verificarLimitesDosSlides([s("item", "a", "b", "Sebrae, 2025")], { ramoSaude: false }).join()).toMatch(/só o tipo "dado" leva fonte/);
  });
  it("antes-depois e prova-fala não valem em ramo de saúde", () => {
    expect(verificarLimitesDosSlides([s("antes-depois")], { ramoSaude: true }).join()).toMatch(/saúde/);
    expect(verificarLimitesDosSlides([s("prova-fala", "Ana", "relaxa que sai sim")], { ramoSaude: true }).join()).toMatch(/saúde/);
    expect(verificarLimitesDosSlides([s("antes-depois")], { ramoSaude: false })).toEqual([]);
  });
  it("capa-foto e prova-resultado só existem com foto", () => {
    expect(verificarLimitesDosSlides([s("capa-foto"), s("prova-resultado", "Resultado", "")], { ramoSaude: false, fotosPrometidas: 1 }).join()).toMatch(/2 slides pedem foto.*tem 1/);
    expect(verificarLimitesDosSlides([s("capa-foto"), s("prova-resultado", "Resultado", "")], { ramoSaude: false, fotosPrometidas: 2 })).toEqual([]);
    expect(verificarLimitesDosSlides([s("capa-texto")], { ramoSaude: false, fotosPrometidas: 0 })).toEqual([]);
  });
  it("prova-fala só vale com uma frase que o cliente disse de verdade (está nas fontes)", () => {
    const fontes = 'Frases da fala: "Relaxa que sai sim", "é só passar o pano".';
    expect(verificarLimitesDosSlides([s("prova-fala", "Ana", "Relaxa que sai sim")], { ramoSaude: false, fontes })).toEqual([]);
    expect(verificarLimitesDosSlides([s("prova-fala", "Ana", "Melhor serviço da cidade")], { ramoSaude: false, fontes }).join()).toMatch(/disse de verdade/);
  });
});

describe("legenda e hashtags", () => {
  it("confere o tamanho da legenda e de 3 a 8 hashtags", () => {
    expect(verificarLegenda("Salve este post", ["#a", "#b", "#c"])).toEqual([]);
    expect(verificarLegenda("", ["#a", "#b", "#c"]).join()).toMatch(/vazia/);
    expect(verificarLegenda(Array.from({ length: 151 }, () => "x").join(" "), ["#a", "#b", "#c"]).join()).toMatch(/151 palavras/);
    expect(verificarLegenda("ok", ["#a", "#b"]).join()).toMatch(/hashtags: 2/);
    expect(verificarLegenda("ok", ["a", "b", "c", "d", "e", "f", "g", "h", "i"]).join()).toMatch(/hashtags: 9/);
  });
  it("normaliza: põe o #, tira espaço e repetição", () => {
    expect(normalizarHashtags(["dicas", "#Dicas", " # nova ", "##x"])).toEqual(["#dicas", "#nova", "#x"]);
  });
});

describe("ajustarAosLimites", () => {
  it("corta o que passa do limite do tipo e diz o que cortou", () => {
    const longo = Array.from({ length: 40 }, (_, i) => `p${i}`).join(" ");
    const r = ajustarAosLimites({ tipo: "passo", titulo: "curto", corpo: longo, fonte: null });
    expect(r.slide.corpo.split(" ")).toHaveLength(30);
    expect(r.cortou).toHaveLength(1);
    expect(ajustarAosLimites({ tipo: "passo", titulo: "curto", corpo: "ok", fonte: null }).cortou).toEqual([]);
  });
});
