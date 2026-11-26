/**
 * E76 PR 3: as regras da estratégia de idioma (a marca de mais de um país). A tela (`faltaNaEstrategia`) e o servidor (`estrategiaIdiomaSchema`)
 * têm de concordar, e a marca de um país só nunca recebe estratégia nenhuma (`estrategiaDaMarca`).
 */
import { describe, expect, it } from "vitest";

import type { EstrategiaIdioma } from "@/db/schema";

import {
  estrategiaDaMarca,
  estrategiaDoFormulario,
  estrategiaIdiomaSchema,
  estrategiaTemOutroIdioma,
  faltaNaEstrategia,
  falaPodeSairForaDoPortugues,
  normalizarEstrategiaIdioma,
  TAMANHO_MAXIMO_DO_COMO_OUTRO,
  type EscolhaDeIdiomaNaTela,
} from "./estrategia-de-idioma";

const LINHA_EM_INGLES: EstrategiaIdioma = { modo: "linha_no_outro", principal: "portugues", segundo: "ingles", comoOutro: null };

describe("estrategiaIdiomaSchema e normalizarEstrategiaIdioma", () => {
  it("só português e só inglês fixam o principal e zeram o resto, mesmo que a tela mande outra coisa", () => {
    const soPt = estrategiaIdiomaSchema.parse({ modo: "so_portugues", principal: "ingles", segundo: "espanhol", comoOutro: "x" });
    expect(normalizarEstrategiaIdioma(soPt)).toEqual({ modo: "so_portugues", principal: "portugues", segundo: null, comoOutro: null });
    const soEn = estrategiaIdiomaSchema.parse({ modo: "so_ingles" });
    expect(normalizarEstrategiaIdioma(soEn)).toEqual({ modo: "so_ingles", principal: "ingles", segundo: null, comoOutro: null });
  });

  it("a linha no outro e a metade exigem o principal e o segundo, diferentes", () => {
    expect(estrategiaIdiomaSchema.safeParse({ modo: "linha_no_outro", principal: "portugues" }).success).toBe(false);
    expect(estrategiaIdiomaSchema.safeParse({ modo: "metade", segundo: "ingles" }).success).toBe(false);
    expect(estrategiaIdiomaSchema.safeParse({ modo: "metade", principal: "ingles", segundo: "ingles" }).success).toBe(false);
    const metade = estrategiaIdiomaSchema.parse({ modo: "metade", principal: "ingles", segundo: "portugues", comoOutro: "sobra" });
    expect(normalizarEstrategiaIdioma(metade)).toEqual({ modo: "metade", principal: "ingles", segundo: "portugues", comoOutro: null });
  });

  it("outro jeito exige a frase e o principal, e guarda a frase sem espaço nas pontas", () => {
    expect(estrategiaIdiomaSchema.safeParse({ modo: "outro", principal: "portugues", comoOutro: "   " }).success).toBe(false);
    expect(estrategiaIdiomaSchema.safeParse({ modo: "outro", comoOutro: "só inglês nos Reels" }).success).toBe(false);
    const outro = estrategiaIdiomaSchema.parse({ modo: "outro", principal: "portugues", segundo: "ingles", comoOutro: "  só inglês nos Reels  " });
    expect(normalizarEstrategiaIdioma(outro)).toEqual({ modo: "outro", principal: "portugues", segundo: null, comoOutro: "só inglês nos Reels" });
  });

  it("recusa a frase maior que o limite e o modo ou idioma que não existe", () => {
    expect(estrategiaIdiomaSchema.safeParse({ modo: "outro", principal: "portugues", comoOutro: "a".repeat(TAMANHO_MAXIMO_DO_COMO_OUTRO + 1) }).success).toBe(false);
    expect(estrategiaIdiomaSchema.safeParse({ modo: "bilingue" }).success).toBe(false);
    expect(estrategiaIdiomaSchema.safeParse({ modo: "metade", principal: "frances", segundo: "ingles" }).success).toBe(false);
  });
});

describe("estrategiaDaMarca", () => {
  it("só vale com mais de um país: a marca de um país só nunca tem estratégia, mesmo com a coluna preenchida", () => {
    for (const alcance of ["brasil", "local", "outro_pais", null] as const) {
      expect(estrategiaDaMarca({ alcance, estrategiaIdioma: LINHA_EM_INGLES })).toBeNull();
    }
    expect(estrategiaDaMarca({ alcance: "mais_de_um_pais", estrategiaIdioma: null })).toBeNull();
    expect(estrategiaDaMarca({ alcance: "mais_de_um_pais", estrategiaIdioma: LINHA_EM_INGLES })).toEqual(LINHA_EM_INGLES);
  });

  it("uma estratégia guardada que não passa mais na validação vira nula, em vez de chegar torta ao prompt", () => {
    const torta = { modo: "metade", principal: "portugues", segundo: "portugues", comoOutro: null } as EstrategiaIdioma;
    expect(estrategiaDaMarca({ alcance: "mais_de_um_pais", estrategiaIdioma: torta })).toBeNull();
  });
});

describe("estrategiaTemOutroIdioma", () => {
  it("só português não muda nada; os outros modos põem texto fora do português", () => {
    expect(estrategiaTemOutroIdioma(null)).toBe(false);
    expect(estrategiaTemOutroIdioma(undefined)).toBe(false);
    expect(estrategiaTemOutroIdioma({ modo: "so_portugues", principal: "portugues", segundo: null, comoOutro: null })).toBe(false);
    expect(estrategiaTemOutroIdioma({ modo: "so_ingles", principal: "ingles", segundo: null, comoOutro: null })).toBe(true);
    expect(estrategiaTemOutroIdioma(LINHA_EM_INGLES)).toBe(true);
    expect(estrategiaTemOutroIdioma({ modo: "outro", principal: "portugues", segundo: null, comoOutro: "só inglês nos Reels" })).toBe(true);
  });
});

describe("falaPodeSairForaDoPortugues", () => {
  it("só quando o principal não é o português, ou no outro jeito; com o português como principal, a fala continua em português", () => {
    expect(falaPodeSairForaDoPortugues(null)).toBe(false);
    expect(falaPodeSairForaDoPortugues({ modo: "so_portugues", principal: "portugues", segundo: null, comoOutro: null })).toBe(false);
    expect(falaPodeSairForaDoPortugues(LINHA_EM_INGLES)).toBe(false);
    expect(falaPodeSairForaDoPortugues({ modo: "metade", principal: "portugues", segundo: "ingles", comoOutro: null })).toBe(false);
    expect(falaPodeSairForaDoPortugues({ modo: "so_ingles", principal: "ingles", segundo: null, comoOutro: null })).toBe(true);
    expect(falaPodeSairForaDoPortugues({ modo: "metade", principal: "espanhol", segundo: "portugues", comoOutro: null })).toBe(true);
    expect(falaPodeSairForaDoPortugues({ modo: "outro", principal: "portugues", segundo: null, comoOutro: "só inglês nos Reels" })).toBe(true);
  });
});

describe("a tela e o servidor concordam", () => {
  const vazia: EscolhaDeIdiomaNaTela = { modo: "", principal: "", segundo: "", comoOutro: "" };

  it("faltaNaEstrategia diz o que falta, na ordem em que a pessoa responde", () => {
    expect(faltaNaEstrategia(vazia)).toBe("modo");
    expect(faltaNaEstrategia({ ...vazia, modo: "so_portugues" })).toBeNull();
    expect(faltaNaEstrategia({ ...vazia, modo: "metade" })).toBe("principal");
    expect(faltaNaEstrategia({ ...vazia, modo: "metade", principal: "portugues" })).toBe("segundo");
    expect(faltaNaEstrategia({ ...vazia, modo: "metade", principal: "portugues", segundo: "portugues" })).toBe("segundo");
    expect(faltaNaEstrategia({ ...vazia, modo: "metade", principal: "portugues", segundo: "ingles" })).toBeNull();
    expect(faltaNaEstrategia({ ...vazia, modo: "outro", principal: "ingles" })).toBe("comoOutro");
    expect(faltaNaEstrategia({ ...vazia, modo: "outro", principal: "ingles", comoOutro: "metade dos posts em cada" })).toBeNull();
  });

  it("toda escolha completa da tela passa no servidor, e a incompleta não", () => {
    const escolhas: EscolhaDeIdiomaNaTela[] = [
      { ...vazia, modo: "so_portugues" },
      { ...vazia, modo: "so_ingles", principal: "espanhol" },
      { ...vazia, modo: "linha_no_outro", principal: "portugues", segundo: "ingles" },
      { ...vazia, modo: "linha_no_outro", principal: "portugues" },
      { ...vazia, modo: "metade", principal: "ingles", segundo: "espanhol" },
      { ...vazia, modo: "outro", principal: "portugues", comoOutro: "só inglês nos Reels" },
      { ...vazia, modo: "outro", principal: "portugues" },
    ];
    for (const escolha of escolhas) {
      const completa = faltaNaEstrategia(escolha) === null;
      expect(estrategiaIdiomaSchema.safeParse(estrategiaDoFormulario(escolha)).success).toBe(completa);
    }
  });

  it("estrategiaDoFormulario manda só os campos que o modo usa", () => {
    expect(estrategiaDoFormulario(vazia)).toBeUndefined();
    expect(estrategiaDoFormulario({ modo: "so_ingles", principal: "portugues", segundo: "espanhol", comoOutro: "x" })).toEqual({
      modo: "so_ingles",
      principal: null,
      segundo: null,
      comoOutro: null,
    });
    expect(estrategiaDoFormulario({ modo: "outro", principal: "portugues", segundo: "ingles", comoOutro: "  só inglês nos Reels " })).toEqual({
      modo: "outro",
      principal: "portugues",
      segundo: null,
      comoOutro: "só inglês nos Reels",
    });
  });
});
