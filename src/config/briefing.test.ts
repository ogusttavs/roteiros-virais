import { describe, expect, it } from "vitest";

import { PERGUNTAS_BRIEFING } from "./briefing";

/** brief-frontend.md 6.2, "Ajuste de 06/09/2026": a lista de notas precisa de um rótulo curto por pergunta. */
describe("PERGUNTAS_BRIEFING", () => {
  it("tem doze perguntas", () => {
    expect(PERGUNTAS_BRIEFING).toHaveLength(12);
  });

  it("toda pergunta tem rotuloCurto, não vazio", () => {
    for (const pergunta of PERGUNTAS_BRIEFING) {
      expect(pergunta.rotuloCurto.trim().length).toBeGreaterThan(0);
    }
  });

  it("os rótulos curtos são exatamente os do brief-frontend.md", () => {
    const rotulos = Object.fromEntries(PERGUNTAS_BRIEFING.map((p) => [p.id, p.rotuloCurto]));
    expect(rotulos).toEqual({
      p1: "o que você faz",
      p2: "o que mais vende",
      p3: "o que faz diferente",
      p4: "sua cliente",
      p5: "o medo dela",
      p6: "perguntas repetidas",
      p7: "o que quer que aconteça",
      p8: "onde posta hoje",
      p9: "suas frases",
      p10: "o que nunca diria",
      p11: "o que dá para mostrar",
      p12: "referências e concorrentes",
    });
  });
});
