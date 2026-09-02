import { describe, expect, it } from "vitest";

import { verificarLinha } from "./checar-texto-regras";

describe("verificarLinha", () => {
  it("aceita texto limpo", () => {
    expect(verificarLinha("gente te conhecer, sem travessao nem emoji")).toEqual([]);
  });

  it("reprova travessao", () => {
    const motivos = verificarLinha("um texto \u2014 com travessao");
    expect(motivos.some((m) => m.includes("travessao"))).toBe(true);
  });

  it("reprova emoji", () => {
    const motivos = verificarLinha("seu roteiro esta pronto \u{1F389}");
    expect(motivos.some((m) => m.includes("emoji"))).toBe(true);
  });

  it("reprova jargao mas aceita gancho", () => {
    expect(verificarLinha("olha o hook do video").some((m) => m.includes("hook"))).toBe(true);
    expect(verificarLinha("olha o gancho do video")).toEqual([]);
  });

  it("reprova as palavras da secao 8 do brief-frontend", () => {
    for (const palavra of [
      "engajamento",
      "conversao",
      "alcance",
      "CTA",
      "metricas",
      "dashboard",
      "viral",
      "conteudo",
      "onboarding",
    ]) {
      expect(verificarLinha(`texto com ${palavra} no meio`).length).toBeGreaterThan(0);
    }
  });
});
