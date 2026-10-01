import { describe, expect, it } from "vitest";

import { JANELA_SEMANA_MS, LIMITE_HASHTAGS_SEMANA, numeroDaSemana, termosDaSemana, termosPorNicho } from "./meta-hashtags";

describe("termosPorNicho (V12b, item 5)", () => {
  it("divide o limite semanal pelos nichos ativos, arredondando para baixo", () => {
    expect(termosPorNicho(1)).toBe(30);
    expect(termosPorNicho(3)).toBe(10);
    expect(termosPorNicho(5)).toBe(6);
    expect(termosPorNicho(6)).toBe(5);
  });

  it("nunca menos que 3, mesmo com muitos nichos ativos", () => {
    expect(termosPorNicho(10)).toBe(3);
    expect(termosPorNicho(30)).toBe(3);
    expect(termosPorNicho(100)).toBe(3);
  });
});

describe("numeroDaSemana (V12b, item 5)", () => {
  it("cresce um a cada sete dias, a partir da epoca", () => {
    const semanaZero = numeroDaSemana(new Date(0));
    const seteDiasDepois = numeroDaSemana(new Date(JANELA_SEMANA_MS));
    const umDiaAntesDeCompletarAsemana = numeroDaSemana(new Date(JANELA_SEMANA_MS - 1));

    expect(semanaZero).toBe(0);
    expect(seteDiasDepois).toBe(1);
    expect(umDiaAntesDeCompletarAsemana).toBe(0);
  });
});

describe("termosDaSemana, o rodizio do ponto de partida (V12b, item 5)", () => {
  const termos = Array.from({ length: 12 }, (_, i) => `termo-${i}`);

  it("semana par comeca no termo 0", () => {
    expect(termosDaSemana(termos, 6, 0)).toEqual(["termo-0", "termo-1", "termo-2", "termo-3", "termo-4", "termo-5"]);
    expect(termosDaSemana(termos, 6, 2)).toEqual(["termo-0", "termo-1", "termo-2", "termo-3", "termo-4", "termo-5"]);
  });

  it("semana impar comeca no termo da posicao `quantidade`, o resto entra que nao entrou na par", () => {
    expect(termosDaSemana(termos, 6, 1)).toEqual([
      "termo-6",
      "termo-7",
      "termo-8",
      "termo-9",
      "termo-10",
      "termo-11",
    ]);
    expect(termosDaSemana(termos, 6, 3)).toEqual([
      "termo-6",
      "termo-7",
      "termo-8",
      "termo-9",
      "termo-10",
      "termo-11",
    ]);
  });

  it("nicho com menos termos que a quantidade: nunca fica vazio, nem nas semanas impares", () => {
    const poucosTermos = ["unico-termo"];
    expect(termosDaSemana(poucosTermos, 30, 0)).toEqual(["unico-termo"]);
    expect(termosDaSemana(poucosTermos, 30, 1)).toEqual(["unico-termo"]);
  });

  it("a fatia da semana impar da a volta no fim da lista: sempre `quantidade` termos, sem repetir (hotfix de 01/10/2026)", () => {
    const trintaECinco = Array.from({ length: 35 }, (_, i) => `termo-${i}`);
    const impar = termosDaSemana(trintaECinco, 30, 1);
    expect(impar).toHaveLength(30);
    expect(new Set(impar).size).toBe(30);
    expect(impar.slice(0, 5)).toEqual(["termo-30", "termo-31", "termo-32", "termo-33", "termo-34"]);
    expect(impar[5]).toBe("termo-0");
    expect(termosDaSemana(trintaECinco, 30, 0)).toHaveLength(30);
  });

  it("nicho sem termo nenhum devolve lista vazia, nas duas paridades", () => {
    expect(termosDaSemana([], 30, 0)).toEqual([]);
    expect(termosDaSemana([], 30, 1)).toEqual([]);
  });

  it("nicho com mais termos que cabe nas duas janelas: os do meio entram na fatia certa, nada de fora do intervalo", () => {
    const termosLongos = Array.from({ length: 20 }, (_, i) => `termo-${i}`);
    expect(termosDaSemana(termosLongos, 6, 0)).toHaveLength(6);
    expect(termosDaSemana(termosLongos, 6, 1)).toHaveLength(6);
    expect(termosDaSemana(termosLongos, 6, 0)).toEqual(termosLongos.slice(0, 6));
    expect(termosDaSemana(termosLongos, 6, 1)).toEqual(termosLongos.slice(6, 12));
  });

  it("no limite real (30 hashtags, 5 nichos, 6 termos cada): duas semanas cobrem 12 dos termos do nicho", () => {
    const quantidade = termosPorNicho(5);
    expect(quantidade).toBe(6);
    expect(quantidade * 5).toBeLessThanOrEqual(LIMITE_HASHTAGS_SEMANA);
  });
});
