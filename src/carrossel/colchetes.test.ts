import { describe, expect, it } from "vitest";

import type { SlideDoCarrossel } from "@/config/carrossel";

import { dividirPorColchetes, slidesComColchete, temColchete, trechosEntreColchetes } from "./colchetes";

describe("o espaço para completar", () => {
  it("acha os trechos entre colchetes, na ordem", () => {
    expect(trechosEntreColchetes("Ligue para [telefone da clínica] e confira [os horários de atendimento].")).toEqual(["[telefone da clínica]", "[os horários de atendimento]"]);
  });
  it("colchete vazio, só com espaço ou quebrado em linhas não conta", () => {
    expect(temColchete("Sem nada [] aqui")).toBe(false);
    expect(temColchete("Sem nada [   ] aqui")).toBe(false);
    expect(temColchete("quebra [abre\nfecha] em linhas")).toBe(false);
    expect(temColchete("Texto limpo, sem colchete")).toBe(false);
  });
  it("divide o texto marcando só o trecho do colchete", () => {
    expect(dividirPorColchetes("Ligue [telefone] hoje")).toEqual([{ texto: "Ligue ", colchete: false }, { texto: "[telefone]", colchete: true }, { texto: " hoje", colchete: false }]);
    expect(dividirPorColchetes("[a][b]")).toEqual([{ texto: "[a]", colchete: true }, { texto: "[b]", colchete: true }]);
    expect(dividirPorColchetes("")).toEqual([]);
  });
  it("lista os slides com colchete, em qualquer campo de texto", () => {
    const slides: SlideDoCarrossel[] = [
      { tipo: "capa-texto", titulo: "3 erros" },
      { tipo: "item", titulo: "Um item", texto: "Agende pelo [telefone da clínica]" },
      { tipo: "resumo", titulo: "Resumo", linhas: ["a", "veja [o endereço]"] },
      { tipo: "chamada", titulo: "Quer?", texto: "Salve", acoes: ["Ligue [telefone]", "b"] },
    ];
    expect(slidesComColchete(slides)).toEqual([
      { n: 2, trechos: ["[telefone da clínica]"] },
      { n: 3, trechos: ["[o endereço]"] },
      { n: 4, trechos: ["[telefone]"] },
    ]);
  });
});
