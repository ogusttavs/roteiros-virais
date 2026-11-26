import { describe, expect, it } from "vitest";

import { TIPOS_DE_SLIDE } from "@/config/carrossel";

import {
  CONTRASTE_DA_LETRA_GRANDE,
  CONTRASTE_DO_TEXTO,
  PASSOS_DE_REFORCO,
  aceitaIlustracao,
  contrasteAprovado,
  estiloBase,
  estilosDaMistura,
  piorContrasteAtras,
  pisoDoContraste,
  veuDaIlustracao,
} from "./ilustracao";

describe("onde a ilustracao entra", () => {
  it("antes e depois e resultado nunca recebem; os outros nove tipos recebem", () => {
    expect(aceitaIlustracao("antes-depois")).toBe(false);
    expect(aceitaIlustracao("prova-resultado")).toBe(false);
    const aceitam = TIPOS_DE_SLIDE.filter((t) => aceitaIlustracao(t));
    expect(aceitam.sort()).toEqual(["capa-foto", "capa-texto", "chamada", "dado", "item", "noticia", "passo", "resumo"].sort());
  });
});

describe("a mistura dos dois estilos", () => {
  it("leve onde a imagem e o assunto (item, passo, capa de texto); forte no resumo, na chamada, no dado e na imagem generica", () => {
    expect(estiloBase("item", false)).toBe("leve");
    expect(estiloBase("passo", false)).toBe("leve");
    expect(estiloBase("resumo", false)).toBe("forte");
    expect(estiloBase("chamada", false)).toBe("forte");
    expect(estiloBase("dado", false)).toBe("forte");
    expect(estiloBase("item", true)).toBe("forte");
  });

  it("nunca tres seguidos no mesmo estilo: o terceiro troca", () => {
    const itens = Array.from({ length: 5 }, () => ({ tipo: "item", comFundo: true }));
    const estilos = estilosDaMistura(itens);
    expect(estilos).toEqual(["leve", "leve", "forte", "leve", "leve"]);
    for (let i = 2; i < estilos.length; i += 1) expect(new Set([estilos[i], estilos[i - 1], estilos[i - 2]]).size).toBeGreaterThan(1);
  });

  it("dado, resumo e chamada seguidos: o do meio vira leve, para nunca haver tres iguais", () => {
    expect(estilosDaMistura([{ tipo: "dado", comFundo: true }, { tipo: "resumo", comFundo: true }, { tipo: "chamada", comFundo: true }])).toEqual(["forte", "leve", "forte"]);
  });

  it("a imagem generica fica forte: se o do meio e generico, troca o terceiro, que nao e", () => {
    expect(estilosDaMistura([{ tipo: "item", comFundo: true, generica: true }, { tipo: "resumo", comFundo: true, generica: true }, { tipo: "chamada", comFundo: true }])).toEqual(["forte", "forte", "leve"]);
    // tudo generico: nao ha o que trocar, fica como esta
    expect(estilosDaMistura([{ tipo: "item", comFundo: true, generica: true }, { tipo: "resumo", comFundo: true, generica: true }, { tipo: "chamada", comFundo: true, generica: true }])).toEqual(["forte", "forte", "forte"]);
  });

  it("slide sem imagem de fundo leva nulo e quebra a sequencia", () => {
    const estilos = estilosDaMistura([
      { tipo: "item", comFundo: true },
      { tipo: "item", comFundo: true },
      { tipo: "item", comFundo: false },
      { tipo: "item", comFundo: true },
    ]);
    expect(estilos).toEqual(["leve", "leve", null, "leve"]);
  });

  it("um carrossel de 7 slides de verdade sai com os dois estilos e sem tres seguidos", () => {
    const tipos = ["capa-texto", "item", "item", "passo", "dado", "resumo", "chamada"];
    const estilos = estilosDaMistura(tipos.map((tipo) => ({ tipo, comFundo: true })));
    expect(new Set(estilos)).toEqual(new Set(["leve", "forte"]));
    for (let i = 2; i < estilos.length; i += 1) expect(new Set([estilos[i], estilos[i - 1], estilos[i - 2]]).size).toBeGreaterThan(1);
  });
});

describe("o veu de cada estilo", () => {
  it("o veu base e o decidido: leve 28, bordas 92, painel 93; forte 72 no claro, 78 no escuro e 84 na cor cheia", () => {
    expect(veuDaIlustracao("leve", "claro", 0)).toEqual({ geral: 28, bordas: 92, painel: 93 });
    expect(veuDaIlustracao("forte", "claro", 0)).toEqual({ geral: 72, bordas: 0, painel: 0 });
    expect(veuDaIlustracao("forte", "escuro", 0).geral).toBe(78);
    expect(veuDaIlustracao("forte", "marca", 0).geral).toBe(84);
  });

  it("cada reforco so aumenta o veu e ele tem teto", () => {
    for (const estilo of ["leve", "forte"] as const) {
      for (let r = 1; r <= PASSOS_DE_REFORCO; r += 1) {
        const antes = veuDaIlustracao(estilo, "claro", r - 1);
        const depois = veuDaIlustracao(estilo, "claro", r);
        expect(depois.geral).toBeGreaterThan(antes.geral);
        expect(depois.geral).toBeLessThanOrEqual(97);
        expect(depois.painel).toBeLessThanOrEqual(100);
      }
      expect(veuDaIlustracao(estilo, "claro", 99)).toEqual(veuDaIlustracao(estilo, "claro", PASSOS_DE_REFORCO));
    }
  });
});

describe("o contraste medido no pixel", () => {
  const branco: [number, number, number] = [255, 255, 255];
  const preto: [number, number, number] = [10, 10, 10];

  it("letra branca sobre pixels claros reprova; sobre pixels escuros passa", () => {
    expect(contrasteAprovado([{ cor: branco, tamanho: 34, pixels: [[240, 240, 240], [250, 250, 250]] }])).toBe(false);
    expect(contrasteAprovado([{ cor: branco, tamanho: 34, pixels: [[20, 20, 20], [30, 30, 30]] }])).toBe(true);
  });

  it("um unico pixel brilhante nao reprova, mas uma regiao ruim sim (3o percentil)", () => {
    const bons: [number, number, number][] = Array.from({ length: 99 }, () => [20, 20, 20]);
    expect(piorContrasteAtras(branco, [...bons, [255, 255, 255]])).toBeGreaterThan(CONTRASTE_DO_TEXTO);
    const regiaoRuim: [number, number, number][] = Array.from({ length: 10 }, () => [250, 250, 250]);
    expect(contrasteAprovado([{ cor: branco, tamanho: 34, pixels: [...regiaoRuim, ...bons.slice(0, 90)] }])).toBe(false);
  });

  it("letra grande pede 3, o resto pede 4,5", () => {
    expect(pisoDoContraste(30)).toBe(CONTRASTE_DO_TEXTO);
    expect(pisoDoContraste(116)).toBe(CONTRASTE_DA_LETRA_GRANDE);
    // cinza medio: contraste de uns 3,9 com a letra preta, entre os dois pisos
    const fundo: [number, number, number][] = [[110, 110, 110]];
    expect(piorContrasteAtras([0, 0, 0], fundo)).toBeGreaterThan(3);
    expect(piorContrasteAtras([0, 0, 0], fundo)).toBeLessThan(4.5);
    expect(contrasteAprovado([{ cor: [0, 0, 0], tamanho: 116, pixels: fundo }])).toBe(true);
    expect(contrasteAprovado([{ cor: [0, 0, 0], tamanho: 34, pixels: fundo }])).toBe(false);
  });

  it("sem pixel para medir nao reprova", () => {
    expect(contrasteAprovado([{ cor: preto, tamanho: 34, pixels: [] }])).toBe(true);
  });
});
