import { describe, expect, it } from "vitest";

import { termosCurtosDoTema } from "./termos-curtos";

describe("termosCurtosDoTema (E17 parte 1)", () => {
  it("a sigla em maiúsculas dentro de um texto normal é termo curto", () => {
    expect(termosCurtosDoTema("como usar IA no negócio pequeno")).toEqual(["ia"]);
    expect(termosCurtosDoTema("SEO e MEI para quem vende online")).toEqual(["seo", "mei"]);
  });

  it("sigla conhecida vale em qualquer caixa e sem acento", () => {
    expect(termosCurtosDoTema("usar ia na loja")).toEqual(["ia"]);
    expect(termosCurtosDoTema("vale a pena pix na loja")).toEqual(["pix"]);
  });

  it("palavra curta comum não vira termo, nem em texto todo em maiúsculas", () => {
    expect(termosCurtosDoTema("como fazer de novo no mês que vem")).toEqual([]);
    expect(termosCurtosDoTema("COMO FAZER DE NOVO EM CASA")).toEqual([]);
    expect(termosCurtosDoTema("TENHO UM NEGOCIO COM IA")).toEqual(["ia"]);
  });

  it("não repete e ignora o que tem 4 letras ou mais (essas já são palavras do tema)", () => {
    expect(termosCurtosDoTema("IA e mais IA com CRM e TDAH")).toEqual(["ia", "crm"]);
  });

  it("texto vazio ou só de pontuação não dá nada", () => {
    expect(termosCurtosDoTema("")).toEqual([]);
    expect(termosCurtosDoTema("?! ... 12")).toEqual([]);
  });
});
