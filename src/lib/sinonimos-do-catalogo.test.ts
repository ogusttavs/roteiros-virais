import { describe, expect, it } from "vitest";

import { MAXIMO_DE_SINONIMOS, sinonimosDoTema } from "./sinonimos-do-catalogo";

describe("sinonimosDoTema (E17 parte 1)", () => {
  it("um termo do catálogo no tema traz os outros termos do mesmo ramo, sem repetir o que o tema já diz", () => {
    const sinonimos = sinonimosDoTema("clareamento vale a pena?");
    expect(sinonimos).toEqual(expect.arrayContaining(["dentista", "ortodontia", "implante"]));
    expect(sinonimos).not.toContain("clareamento");
    expect(sinonimos.length).toBeLessThanOrEqual(MAXIMO_DE_SINONIMOS);
  });

  it("não depende de acento nem de maiúscula, e plural e gênero casam", () => {
    expect(sinonimosDoTema("CLÁREAMENTO")).toEqual(sinonimosDoTema("clareamento"));
    expect(sinonimosDoTema("os Dentistas da minha cidade")).toContain("ortodontia");
    expect(sinonimosDoTema("minha cabeleireira favorita")).toContain("barbeiro");
  });

  it("a terminação muda, a palavra não: dente não vira dentista nem dentro", () => {
    expect(sinonimosDoTema("dor de dente")).toEqual([]);
    expect(sinonimosDoTema("dentro de casa")).toEqual([]);
    expect(sinonimosDoTema("dentistas")).toContain("ortodontia");
  });

  it("termo de mais de uma palavra só casa inteiro", () => {
    // "limpeza de pele" é do ramo de estética; só "pele" no tema não basta para trazer o vocabulário dele.
    expect(sinonimosDoTema("cuidar da pele no inverno")).not.toContain("harmonização");
    expect(sinonimosDoTema("limpeza de pele profunda")).toContain("harmonização");
  });

  it("palavra curta só casa igual", () => {
    // "ppf" é termo do catálogo (estética automotiva); "ppfs" e "pp" não podem puxar o ramo.
    expect(sinonimosDoTema("pp")).toEqual([]);
    expect(sinonimosDoTema("ppf")).toContain("envelopamento");
  });

  it("tema que não toca o catálogo, ou vazio, não traz nada", () => {
    expect(sinonimosDoTema("questao juridica sobre contrato extenso")).toEqual([]);
    expect(sinonimosDoTema("   ")).toEqual([]);
    expect(sinonimosDoTema("de da do")).toEqual([]);
  });

  it("respeita o teto e é determinístico", () => {
    expect(sinonimosDoTema("dentista", 3)).toHaveLength(3);
    expect(sinonimosDoTema("dentista")).toEqual(sinonimosDoTema("dentista"));
  });
});
