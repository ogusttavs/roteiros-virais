import { describe, expect, it } from "vitest";

import { montarSistemaEstavel } from "./temasDoDia";

/** R1, item 3: os temas do dia podem citar a regra de plataforma que explica a evidência. */
describe("montarSistemaEstavel, regra de plataforma em porQue (R1, item 3)", () => {
  it("instrui citar a regra só quando ela explica a evidência, nunca em lista solta", () => {
    const sistema = montarSistemaEstavel({ modeloNicho: "modelo do nicho" });
    expect(sistema).toContain("use a ideia dela dentro da própria frase");
    expect(sistema).toContain("nunca escreva o número da regra");
    expect(sistema).toContain("nunca liste regras soltas fora da frase");
  });

  it("traz as quatro bases curtas de regras (Reels, TikTok, Short, Story), sem video longo", () => {
    const sistema = montarSistemaEstavel({ modeloNicho: "modelo do nicho" });
    expect(sistema).toContain("R-IG-REEL-01");
    expect(sistema).toContain("R-TT-VIDEO-01");
    expect(sistema).toContain("R-YT-SHORT-01");
    expect(sistema).toContain("R-IG-STORY-01");
    expect(sistema).not.toContain("R-YT-VIDEO-01");
  });
});
