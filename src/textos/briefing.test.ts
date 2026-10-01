/**
 * E37a, item 3: "Copiar para a sua IA" monta o texto por código, sem chamar IA nenhuma. Este
 * teste prova que o texto sai certo para as 24 perguntas (negócio e pessoa), nunca só para uma
 * de exemplo.
 */
import { describe, expect, it } from "vitest";

import { perguntasDoBriefing } from "@/config/briefing";

import { montarTextoParaIA } from "./briefing";

describe("montarTextoParaIA", () => {
  for (const tipo of ["negocio", "pessoa"] as const) {
    const perguntas = perguntasDoBriefing(tipo);

    it(`${tipo}: monta o texto certo para as 12 perguntas`, () => {
      expect(perguntas).toHaveLength(12);
      for (const pergunta of perguntas) {
        const texto = montarTextoParaIA(pergunta);

        expect(texto).toContain(pergunta.enunciado);
        expect(texto).toContain(pergunta.oQueUmaBoaRespostaTem);
        expect(texto).toContain("Uma boa resposta tem:");
        // As instrucoes fixas, iguais para as 24 perguntas.
        expect(texto).toContain("em primeira pessoa");
        expect(texto).toContain("Sem lista de tópicos");
        // Nunca vazio, nunca cortado pela metade.
        expect(texto.length).toBeGreaterThan(pergunta.enunciado.length + pergunta.oQueUmaBoaRespostaTem.length);
      }
    });
  }

  it("nunca repete o mesmo texto para perguntas diferentes", () => {
    const todas = [...perguntasDoBriefing("negocio"), ...perguntasDoBriefing("pessoa")];
    const textos = todas.map((p) => montarTextoParaIA(p));
    expect(new Set(textos).size).toBe(textos.length);
  });
});
