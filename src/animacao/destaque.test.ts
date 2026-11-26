import { describe, expect, it } from "vitest";

import { nucleoDaPalavra, palavraEmDestaque } from "./destaque";

const destaque = (texto: string): string | null => {
  const palavras = texto.split(" ");
  const faixa = palavraEmDestaque(palavras);
  return faixa ? palavras.slice(faixa[0], faixa[1] + 1).join(" ") : null;
};

describe("nucleoDaPalavra", () => {
  it("tira a pontuação em volta e deixa o % e o R$", () => {
    expect(nucleoDaPalavra("“Avaliação?”")).toBe("avaliação");
    expect(nucleoDaPalavra("80%,")).toBe("80%");
    expect(nucleoDaPalavra("R$")).toBe("r$");
  });
});

describe("palavraEmDestaque", () => {
  it("número primeiro: o número e a palavra que ele conta", () => {
    expect(destaque("Se ficar mais de 2 semanas, a inflamação vira gengivite.")).toBe("2 semanas,");
    expect(destaque("Faça isso 3 vezes por dia")).toBe("3 vezes");
  });
  it("número com unidade junto, ou seguido de palavra comum, fica sozinho", () => {
    expect(destaque("Reduz em 80% o risco de cárie")).toBe("80%");
    expect(destaque("Atendemos 24h por dia na clínica")).toBe("24h");
    expect(destaque("Foram 5 de cada 10 pacientes")).toBe("5");
  });
  it("R$ leva o valor junto", () => {
    expect(destaque("A limpeza custa menos de R$ 200 na avaliação")).toBe("R$ 200");
  });
  it("sem número, a palavra mais longa que não é comum", () => {
    expect(destaque("E a gengivite tratada cedo some em poucos dias")).toBe("gengivite");
    expect(destaque("Agende a sua avaliação pelo link da bio.")).toBe("avaliação");
  });
  it("no empate de tamanho, vale a última", () => {
    expect(destaque("Sangrar a gengiva quando você escova não é normal.")).toBe("gengiva");
  });
  it("palavra comum e advérbio em -mente nunca ganham, mesmo sendo as mais longas", () => {
    expect(destaque("Simplesmente porque você também sabe disso, sorria")).toBe("sorria");
    expect(destaque("Você precisa saber")).toBe("precisa");
    expect(destaque("Muita gente acha que é escova dura demais.")).toBe("escova");
  });
  it("cena só de palavras comuns ou curtas fica sem destaque", () => {
    expect(destaque("E você?")).toBeNull();
    expect(destaque("Isso é tudo")).toBeNull();
  });
  it("é sempre o mesmo para o mesmo texto (regra fixa, sem IA)", () => {
    const texto = "Na maioria das vezes é placa acumulada na linha da gengiva.";
    expect(destaque(texto)).toBe("acumulada");
    expect(destaque(texto)).toBe(destaque(texto));
  });
});
