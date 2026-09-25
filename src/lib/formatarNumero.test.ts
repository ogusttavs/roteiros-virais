import { describe, expect, it } from "vitest";

import {
  classificarMultiplo,
  diasDesde,
  formatarMultiplo,
  formatarVelocidade,
  formatarViewsCompacto,
  formatarViewsExato,
  fraseDiasAtras,
  rotuloMultiploConta,
} from "./formatarNumero";

describe("formatarViewsCompacto", () => {
  it("arredonda para mil e milhão em português", () => {
    expect(formatarViewsCompacto(12000)).toBe("12 mil");
    expect(formatarViewsCompacto(1200)).toBe("1,2 mil");
    expect(formatarViewsCompacto(999)).toBe("999");
    expect(formatarViewsCompacto(3400000)).toBe("3,4 mi");
  });
});

describe("formatarViewsExato", () => {
  it("usa ponto como separador de milhar", () => {
    expect(formatarViewsExato(1240)).toBe("1.240");
    expect(formatarViewsExato(12)).toBe("12");
  });
});

// V9d, item 0b: achado do Gustavo em 25/09, usando o painel. formatarViewsExato(7.664) imprimia
// "7,664" (sete mil e seiscentos e sessenta e quatro), quando a velocidade de verdade era 7,664
// views por hora, arredondado para 8.
describe("formatarVelocidade", () => {
  it("arredonda para inteiro, sem casas decimais lidas como milhar", () => {
    expect(formatarVelocidade(7.664)).toEqual({ texto: "8", singular: false });
    expect(formatarVelocidade(0.994)).toEqual({ texto: "menos de 1", singular: true });
  });

  it("numeros grandes continuam com separador de milhar (arredondados)", () => {
    expect(formatarVelocidade(1234.5)).toEqual({ texto: "1.235", singular: false });
  });

  it("abaixo de 1, 'menos de 1', singular", () => {
    expect(formatarVelocidade(0.5)).toEqual({ texto: "menos de 1", singular: true });
    expect(formatarVelocidade(0)).toEqual({ texto: "menos de 1", singular: true });
  });

  it("exatamente 1 (ou arredondando para 1) fica singular", () => {
    expect(formatarVelocidade(1)).toEqual({ texto: "1", singular: true });
    expect(formatarVelocidade(1.2)).toEqual({ texto: "1", singular: true });
  });

  it("2 ou mais fica plural", () => {
    expect(formatarVelocidade(2)).toEqual({ texto: "2", singular: false });
  });
});

describe("formatarMultiplo", () => {
  it("sempre uma casa decimal e o x", () => {
    expect(formatarMultiplo(4.1)).toBe("4,1x");
    expect(formatarMultiplo(2)).toBe("2,0x");
  });
});

describe("diasDesde", () => {
  it("zero no mesmo dia, ignora hora", () => {
    const hoje = new Date(2026, 8, 7, 23, 0);
    expect(diasDesde(new Date(2026, 8, 7, 1, 0), hoje)).toBe(0);
  });

  it("conta dias corridos de calendario", () => {
    const hoje = new Date(2026, 8, 7, 8, 0);
    expect(diasDesde(new Date(2026, 8, 5, 20, 0), hoje)).toBe(2);
  });
});

describe("fraseDiasAtras", () => {
  it("nunca em 0 dias", () => {
    expect(fraseDiasAtras(0)).toBe("hoje");
    expect(fraseDiasAtras(1)).toBe("ontem");
    expect(fraseDiasAtras(3)).toBe("em 3 dias");
  });
});

describe("classificarMultiplo e rotuloMultiploConta", () => {
  it("acima a partir de 1,5x", () => {
    expect(classificarMultiplo(1.5)).toBe("acima");
    expect(classificarMultiplo(4.1)).toBe("acima");
    expect(rotuloMultiploConta("acima")).toBe("acima do normal dessa conta");
  });

  it("na media entre 0,8 e 1,5", () => {
    expect(classificarMultiplo(0.8)).toBe("media");
    expect(classificarMultiplo(1.2)).toBe("media");
    expect(rotuloMultiploConta("media")).toBe("na média dessa conta");
  });

  it("abaixo do normal abaixo de 0,8", () => {
    expect(classificarMultiplo(0.3)).toBe("abaixo");
    expect(rotuloMultiploConta("abaixo")).toBe("abaixo do normal dessa conta");
  });

  it("origem conta ou seguidores usam o mesmo texto de \"dessa conta\" (sem origem propria)", () => {
    expect(rotuloMultiploConta("acima", "conta")).toBe("acima do normal dessa conta");
    expect(rotuloMultiploConta("acima", "seguidores")).toBe("acima do normal dessa conta");
    expect(rotuloMultiploConta("acima", null)).toBe("acima do normal dessa conta");
  });

  it("origem setor troca para \"do seu setor\" nas tres faixas", () => {
    expect(rotuloMultiploConta("acima", "setor")).toBe("acima da média do seu setor");
    expect(rotuloMultiploConta("media", "setor")).toBe("na média do seu setor");
    expect(rotuloMultiploConta("abaixo", "setor")).toBe("abaixo da média do seu setor");
  });
});
