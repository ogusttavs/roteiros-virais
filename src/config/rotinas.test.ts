/** As rotinas em língua de gente (E46 PR 3): nenhuma fila fica de fora da tela, nenhuma aparece duas vezes, e o horário lido do agendamento não mente. */
import { describe, expect, it } from "vitest";

import { FILAS } from "@/jobs/fila";

import { NOME_DA_FILA, quandoDoCron, ROTINAS } from "./rotinas";

describe("ROTINAS", () => {
  it("toda fila está em exatamente uma rotina", () => {
    const todas = ROTINAS.flatMap((r) => r.filas);
    expect(new Set(todas).size).toBe(todas.length);
    expect([...todas].sort()).toEqual(Object.values(FILAS).sort());
  });
});

describe("NOME_DA_FILA", () => {
  it("toda fila tem o nome em língua de gente, e só as filas que existem", () => {
    expect(Object.keys(NOME_DA_FILA).sort()).toEqual(Object.values(FILAS).sort());
  });
});

describe("quandoDoCron", () => {
  it("lê os formatos que o agendamento usa", () => {
    expect(quandoDoCron("30 3 * * *")).toBe("todo dia às 03:30");
    expect(quandoDoCron("0 * * * *")).toBe("de hora em hora, em ponto");
    expect(quandoDoCron("20 * * * *")).toBe("de hora em hora, aos 20 minutos");
    expect(quandoDoCron("0 5 * * 0")).toBe("todo domingo às 05:00");
    expect(quandoDoCron("0 2 1 * *")).toBe("todo dia 1 do mês às 02:00");
  });

  it("o que não reconhece volta cru", () => {
    expect(quandoDoCron("*/5 3-6 * * 1-5")).toBe("*/5 3-6 * * 1-5");
  });
});
