/** O que não precisa de banco no admin de contas (E46 PR 1): os sete dias de cada conta e quem é "Usando" ou "Parou". */
import { describe, expect, it } from "vitest";

import { classificarUso, estadosDosDias, type EstadoDoDia } from "./admin-contas";

const dias = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

describe("estadosDosDias", () => {
  it("o mais forte do dia vale: gravou, depois gerou roteiro, depois só entrou, depois nada", () => {
    const roteiros = new Map([
      ["2026-09-28", { gravado: true }],
      ["2026-09-29", { gravado: false }],
      ["2026-09-30", { gravado: false }],
    ]);
    const entrou = new Set(["2026-09-28", "2026-09-30", "2026-10-01"]);
    const estados = estadosDosDias(dias, roteiros, entrou).map((d) => d.estado);
    expect(estados).toEqual(["gravou", "gerou", "gerou", "entrou", "nada", "nada", "nada"]);
  });
});

function semana(...estados: EstadoDoDia[]) {
  return estados.map((estado) => ({ estado }));
}

describe("classificarUso", () => {
  it("Usando: gravou em algum dos últimos 3 dias", () => {
    expect(classificarUso(semana("nada", "nada", "nada", "nada", "gravou", "nada", "nada")).usando).toBe(true);
    expect(classificarUso(semana("gravou", "nada", "nada", "nada", "nada", "gerou", "entrou")).usando).toBe(false);
  });

  it("Parou: os 4 dias completos antes de hoje sem nada (nem entrar), e hoje também sem nada", () => {
    expect(classificarUso(semana("gravou", "gravou", "nada", "nada", "nada", "nada", "nada")).parou).toBe(true);
    expect(classificarUso(semana("gravou", "gravou", "nada", "nada", "entrou", "nada", "nada")).parou).toBe(false);
  });

  it("o dia de hoje pela metade não decide: só 3 dias completos sem nada ainda não é Parou, e uma entrada hoje tira de Parou", () => {
    expect(classificarUso(semana("gravou", "gravou", "gravou", "nada", "nada", "nada", "nada")).parou).toBe(false);
    expect(classificarUso(semana("gravou", "gravou", "nada", "nada", "nada", "nada", "entrou")).parou).toBe(false);
  });
});
