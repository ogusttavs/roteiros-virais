import { describe, expect, it } from "vitest";

import { escolherChaveDeTestes } from "./chave-de-testes";

describe("escolherChaveDeTestes", () => {
  it("com ANTHROPIC_API_KEY_TESTES, vale a de testes, mesmo havendo a normal", () => {
    const escolha = escolherChaveDeTestes({ ANTHROPIC_API_KEY_TESTES: "sk-testes", ANTHROPIC_API_KEY: "sk-producao" });
    expect(escolha).toMatchObject({ fonte: "testes", chave: "sk-testes" });
    expect(escolha.aviso).toContain("ANTHROPIC_API_KEY_TESTES");
  });

  it("sem a de testes, vale a normal e o aviso diz qual está em uso e como separar", () => {
    const escolha = escolherChaveDeTestes({ ANTHROPIC_API_KEY: "sk-producao" });
    expect(escolha).toMatchObject({ fonte: "normal", chave: "sk-producao" });
    expect(escolha.aviso).toContain("a normal");
  });

  it("a de testes vazia ou só com espaços não conta", () => {
    expect(escolherChaveDeTestes({ ANTHROPIC_API_KEY_TESTES: "   ", ANTHROPIC_API_KEY: "sk-producao" }).fonte).toBe("normal");
  });

  it("sem nenhuma chave, o aviso diz que sai em mock", () => {
    expect(escolherChaveDeTestes({})).toMatchObject({ fonte: "nenhuma", chave: "" });
    expect(escolherChaveDeTestes({}).aviso).toContain("mock");
  });
});
