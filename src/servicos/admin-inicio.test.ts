/** A regra do "ramo com problema" no Início do admin (E46 PR 1). */
import { describe, expect, it } from "vitest";

import { horaNoBrasil, ramoComProblema, type LinhaDaMadrugada } from "./admin-inicio";

function linha(parcial: Partial<Omit<LinhaDaMadrugada, "comProblema">> = {}): Omit<LinhaDaMadrugada, "comProblema"> {
  return {
    nichoId: 1,
    nome: "Dentistas",
    busca: { estado: "ok", novos: 10 },
    transcricao: { estado: "ok", transcritos: 5 },
    analise: { analisados: 3 },
    temas: { quantos: 3, tentou: true, atrasado: false },
    ...parcial,
  };
}

describe("ramoComProblema", () => {
  it("tudo certo não é problema", () => {
    expect(ramoComProblema(linha())).toBe(false);
  });

  it("busca ou transcrição em erro é problema", () => {
    expect(ramoComProblema(linha({ busca: { estado: "erro", novos: 0 } }))).toBe(true);
    expect(ramoComProblema(linha({ transcricao: { estado: "erro", transcritos: 0 } }))).toBe(true);
  });

  it("sem tema só é problema depois da hora em que ele já devia existir", () => {
    expect(ramoComProblema(linha({ temas: { quantos: 0, tentou: false, atrasado: false } }))).toBe(false);
    expect(ramoComProblema(linha({ temas: { quantos: 0, tentou: false, atrasado: true } }))).toBe(true);
  });
});

describe("horaNoBrasil", () => {
  it("lê a hora do Brasil, não a do servidor", () => {
    expect(horaNoBrasil(new Date("2026-10-04T11:30:00Z"))).toBe(8);
    expect(horaNoBrasil(new Date("2026-10-04T02:59:00Z"))).toBe(23);
  });
});
