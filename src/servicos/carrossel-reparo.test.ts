import { describe, expect, it } from "vitest";

import type { SaidaCarrossel } from "@/ia/prompts/carrossel";

import { aplicarTrocasNosCampos } from "./carrossel";

const vazio = { rotulo: "", titulo: "", texto: "", antes: "", depois: "", valor: "", unidade: "", fonte: "", referencia: "", quem: "", contexto: "", linhas: [] as string[], acoes: [] as string[] };

const saida: SaidaCarrossel = {
  slides: [
    { ...vazio, tipo: "capa-texto", rotulo: "Dicas", titulo: "3 cuidados com a escovação", texto: "Para você salvar" },
    { ...vazio, tipo: "item", rotulo: "Dica 1", titulo: "Escove devagar", texto: "A gente atende muita criança pequena." },
    { ...vazio, tipo: "resumo", titulo: "Para guardar", linhas: ["Escove devagar", "Use fio dental", "Troque a escova"] },
    { ...vazio, tipo: "chamada", titulo: "Salve este post", texto: "Mande para alguém.", acoes: ["Salve para lembrar", "Mande para alguém"] },
  ],
  legenda: "Cuide do sorriso e comente.",
  hashtags: ["#dicas"],
  evidencias: [],
};

describe("T80: aplicarTrocasNosCampos", () => {
  it("troca só o campo apontado, sem tocar no resto", () => {
    const novo = aplicarTrocasNosCampos(saida, { "slide 2 campo 3": "Escovar bem protege os dentes." }, true);
    expect(novo.slides[1].texto).toBe("Escovar bem protege os dentes.");
    expect(novo.slides[1].titulo).toBe("Escove devagar");
    expect(novo.slides[0]).toEqual(saida.slides[0]);
    expect(novo.slides[3]).toEqual(saida.slides[3]);
    expect(saida.slides[1].texto).toBe("A gente atende muita criança pequena.");
  });

  it("troca um item de lista e uma ação, e a legenda", () => {
    const novo = aplicarTrocasNosCampos(saida, { "slide 3 campo 3": "Use fio dental todo dia", "slide 4 campo 3": "Salve para ver depois", legenda: "Nova legenda." }, false);
    expect(novo.slides[2].linhas).toEqual(["Escove devagar", "Use fio dental todo dia", "Troque a escova"]);
    expect(novo.slides[3].acoes).toEqual(["Salve para ver depois", "Mande para alguém"]);
    expect(novo.legenda).toBe("Nova legenda.");
  });

  it("campo que não existe é ignorado", () => {
    expect(aplicarTrocasNosCampos(saida, { "slide 9 campo 1": "x" }, false)).toEqual(saida);
  });
});
