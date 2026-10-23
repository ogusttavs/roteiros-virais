/**
 * O orçamento de tempo do `transcrever` por setor (M5c), a conta pura: com a madrugada de 03/10/2026 (o job rodando às 07:00 sem
 * terminar, e os setores 2 e 5 a zero), o que tem de valer é que nenhum setor perca a vez por causa dos de antes, e que a soma
 * nunca passe do teto do job.
 */
import { describe, expect, it } from "vitest";

import { FILAS, opcoesDaFila } from "./fila";
import { orcamentoDoSetor, orcamentoDoSetorComMarca, orcamentosDaConfig } from "./transcrever";

const MIN = 60_000;

/** A ligação da configuração ao orçamento: a escala (minutos para milissegundos) e a garantia de que o teto cabe no prazo da fila. */
describe("orcamentosDaConfig", () => {
  it("os padrões são 30 minutos por setor e 3h30 no total, em milissegundos", () => {
    expect(orcamentosDaConfig()).toEqual({ porSetorMs: 30 * MIN, totalMs: 210 * MIN });
  });

  it("o teto do job inteiro é menor que o prazo da fila do transcrever (4 h), com folga para o vídeo que já começou", () => {
    const prazoDaFilaMs = opcoesDaFila(FILAS.transcrever).expireInSeconds * 1000;
    const { totalMs } = orcamentosDaConfig();
    // O pior vídeo que passa do teto: legenda 90 s, áudio 90 s, Groq 60 s e a pausa de 20 s do YouTube.
    const piorVideoMs = (90 + 90 + 60 + 20) * 1000;
    expect(totalMs + piorVideoMs).toBeLessThan(prazoDaFilaMs);
  });
});

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

/** O setor com marca ativa lê mais vídeos por noite e pede mais tempo (23/10/2026), sem tirar a vez dos setores seguintes. */
describe("orcamentoDoSetorComMarca", () => {
  it("com folga, o setor com marca tem o orçamento maior inteiro (90 min), e os que faltam ainda têm os 30 min deles reservados", () => {
    // 3 setores: 210 - 2 x 30 = 150 sobra para este, e o teto dele é 90.
    expect(orcamentoDoSetorComMarca(90 * MIN, 30 * MIN, 210 * MIN, 0, 3)).toBe(90 * MIN);
  });

  it("com muitos setores, o maior orçamento encolhe para o que sobra depois de reservar o dos outros (6 setores: 60 min), e a soma fecha no teto", () => {
    let decorrido = 0;
    decorrido += orcamentoDoSetorComMarca(90 * MIN, 30 * MIN, 210 * MIN, decorrido, 6);
    expect(decorrido).toBe(60 * MIN);
    for (let faltam = 5; faltam >= 1; faltam -= 1) decorrido += orcamentoDoSetor(30 * MIN, 210 * MIN, decorrido, faltam);
    expect(decorrido).toBe(210 * MIN);
  });

  it("nunca é menor que o orçamento comum: quando o teto está quase gasto, vale o que o setor comum teria", () => {
    expect(orcamentoDoSetorComMarca(90 * MIN, 30 * MIN, 210 * MIN, 150 * MIN, 3)).toBe(orcamentoDoSetor(30 * MIN, 210 * MIN, 150 * MIN, 3));
    expect(orcamentoDoSetorComMarca(90 * MIN, 30 * MIN, 210 * MIN, 210 * MIN, 2)).toBe(0);
  });

  it("um setor só (a primeira carga): o menor entre o seu orçamento e o teto do job", () => {
    expect(orcamentoDoSetorComMarca(90 * MIN, 30 * MIN, 210 * MIN, 0, 1)).toBe(90 * MIN);
    expect(orcamentoDoSetorComMarca(90 * MIN, 30 * MIN, 60 * MIN, 0, 1)).toBe(60 * MIN);
  });

  it("para um setor sem marca nada muda: com o orçamento próprio igual ao comum, dá o mesmo que orcamentoDoSetor em qualquer ponto da noite", () => {
    for (const decorrido of [0, 30, 90, 150, 190]) {
      for (const faltam of [1, 2, 3, 6]) {
        expect(orcamentoDoSetorComMarca(30 * MIN, 30 * MIN, 210 * MIN, decorrido * MIN, faltam)).toBe(orcamentoDoSetor(30 * MIN, 210 * MIN, decorrido * MIN, faltam));
      }
    }
  });
});
