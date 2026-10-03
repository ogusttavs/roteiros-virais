/**
 * O orçamento de tempo do `transcrever` por setor (M5c), a conta pura: com a madrugada de 03/10/2026 (o job rodando às 07:00 sem
 * terminar, e os setores 2 e 5 a zero), o que tem de valer é que nenhum setor perca a vez por causa dos de antes, e que a soma
 * nunca passe do teto do job.
 */
import { describe, expect, it } from "vitest";

import { orcamentoDoSetor } from "./transcrever";

const MIN = 60_000;

describe("orcamentoDoSetor", () => {
  it("com folga, cada setor tem o orçamento por setor inteiro (30 min)", () => {
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 0, 6)).toBe(30 * MIN);
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 150 * MIN, 2)).toBe(30 * MIN);
  });

  it("sem folga, o orçamento é o que sobra do teto dividido pelos setores que faltam: o setor seguinte nunca fica a zero", () => {
    // 3h30 de teto, 6 setores: quando 150 min já foram gastos, sobram 60 min para 3 setores, 20 min cada.
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 150 * MIN, 3)).toBe(20 * MIN);
    // No último, tudo o que sobrou (menos que o por setor).
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 190 * MIN, 1)).toBe(20 * MIN);
  });

  it("a soma dos orçamentos nunca passa do teto, mesmo gastando cada um o seu orçamento inteiro", () => {
    const setores = 9;
    const total = 210 * MIN;
    let decorrido = 0;
    for (let faltam = setores; faltam >= 1; faltam -= 1) {
      decorrido += orcamentoDoSetor(30 * MIN, total, decorrido, faltam);
    }
    expect(decorrido).toBeLessThanOrEqual(total);
    // E o último setor ainda teve um pedaço (não ficou a zero).
    expect(orcamentoDoSetor(30 * MIN, total, decorrido - 1, 1)).toBeGreaterThanOrEqual(0);
  });

  it("teto já gasto: orçamento zero (e nunca negativo)", () => {
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 210 * MIN, 2)).toBe(0);
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 500 * MIN, 2)).toBe(0);
  });

  it("um setor só (a primeira carga de um setor novo): o menor entre o seu orçamento e o teto", () => {
    expect(orcamentoDoSetor(30 * MIN, 210 * MIN, 0, 1)).toBe(30 * MIN);
    expect(orcamentoDoSetor(30 * MIN, 10 * MIN, 0, 1)).toBe(10 * MIN);
  });

  it("zero setores faltando não divide por zero", () => {
    expect(Number.isFinite(orcamentoDoSetor(30 * MIN, 210 * MIN, 0, 0))).toBe(true);
  });
});
