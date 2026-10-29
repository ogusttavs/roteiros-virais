import { describe, expect, it } from "vitest";

import { LIMITE_DO_PROMPT_DE_NOMES, promptDeNomes } from "./nomes";

describe("promptDeNomes", () => {
  it("junta a marca, o lugar, o que vende e os concorrentes", () => {
    const p = promptDeNomes({ nomeDaMarca: "Dr.Wash", regiao: "Campinas e região", oQueVende: "produtos de limpeza para casa", concorrentes: ["Ypê", "Qboa"] });
    expect(p).toBe("Vídeo de Dr.Wash, em Campinas e região. produtos de limpeza para casa. Nomes que podem aparecer: Ypê, Qboa.");
  });

  it("sem marca não há prompt", () => {
    expect(promptDeNomes({ nomeDaMarca: "   " })).toBe("");
  });

  it("usa a cidade quando não há região, e ignora campo vazio", () => {
    expect(promptDeNomes({ nomeDaMarca: "Clínica Sorriso", cidade: "Santos", oQueVende: "", concorrentes: [] })).toBe("Vídeo de Clínica Sorriso, em Santos.");
  });

  it("só leva os três primeiros concorrentes", () => {
    const p = promptDeNomes({ nomeDaMarca: "X", concorrentes: ["A", "B", "C", "D"] });
    expect(p).toContain("A, B, C.");
    expect(p).not.toContain("D");
  });

  it("corta no limite sem partir uma palavra", () => {
    const longo = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(" ");
    const p = promptDeNomes({ nomeDaMarca: "Marca", oQueVende: longo });
    expect(p.length).toBeLessThanOrEqual(LIMITE_DO_PROMPT_DE_NOMES);
    expect(p.startsWith("Vídeo de Marca.")).toBe(true);
    expect(p.endsWith(" ")).toBe(false);
  });
});
