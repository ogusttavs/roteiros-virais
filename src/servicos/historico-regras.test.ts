import { describe, expect, it } from "vitest";

import { segundaFeiraIso } from "@/lib/semana";

import { agruparPorSemana } from "./historico-regras";

/** Quarta-feira, para o teste ter uma segunda-feira "desta semana" e uma "semana passada" claras. */
const HOJE = new Date("2026-09-09T12:00:00-03:00");

describe("agruparPorSemana", () => {
  it("data desta semana entra em 'Esta semana'", () => {
    const segunda = segundaFeiraIso(HOJE);
    const grupos = agruparPorSemana([{ data: segunda }], HOJE);
    expect(grupos).toEqual([{ rotulo: "Esta semana", itens: [{ data: segunda }] }]);
  });

  it("fim de semana no meio: domingo da semana passada entra em 'Semana passada', não em 'Esta semana'", () => {
    const segundaEstaSemana = segundaFeiraIso(HOJE);
    const domingoAnterior = new Date(new Date(`${segundaEstaSemana}T12:00:00`).getTime() - 24 * 60 * 60 * 1000);
    const dataDomingo = domingoAnterior.toISOString().slice(0, 10);

    const grupos = agruparPorSemana([{ data: dataDomingo }], HOJE);
    expect(grupos[0].rotulo).toBe("Semana passada");
  });

  it("mais de duas semanas atrás entra pelo nome do mês", () => {
    const grupos = agruparPorSemana([{ data: "2026-07-15" }], HOJE);
    expect(grupos[0].rotulo).toBe("Julho");
  });

  it("agrupa itens adjacentes do mesmo rótulo juntos, preservando a ordem", () => {
    const segunda = segundaFeiraIso(HOJE);
    const grupos = agruparPorSemana(
      [{ data: segunda, id: 1 }, { data: "2026-07-15", id: 2 }, { data: "2026-07-10", id: 3 }],
      HOJE,
    );

    expect(grupos.map((g) => g.rotulo)).toEqual(["Esta semana", "Julho"]);
    expect(grupos[1].itens).toHaveLength(2);
  });
});
