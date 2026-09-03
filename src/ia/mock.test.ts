import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";

import * as avaliarRespostaIA from "./prompts/avaliarResposta";
import { construirSaidaMock } from "./mock";

describe("mock de avaliarResposta", () => {
  const entrada = avaliarRespostaIA.montarEntrada({
    pergunta: "O que o seu negocio faz?",
    oQueAIAProcura: "um exemplo concreto",
    resposta: "Vendo produtos de limpeza feitos por mim, com nota 10 dos clientes.",
  });

  it("inclui exemplo, e o mock inteiro valida contra o schema real da tarefa", () => {
    const saida = avaliarRespostaIA.schema.parse(construirSaidaMock("avaliarResposta", entrada));
    expect(saida.exemplo).toBeTruthy();
    expect(typeof saida.exemplo).toBe("string");
  });

  it("o exemplo tambem passa pelas regras de texto (sem travessao, emoji ou jargao)", () => {
    const saida = avaliarRespostaIA.schema.parse(construirSaidaMock("avaliarResposta", entrada));
    expect(encontrarProblemas(saida.exemplo)).toEqual([]);
  });
});
