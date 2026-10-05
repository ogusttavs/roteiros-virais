import { describe, expect, it } from "vitest";

import { montarEntrada, montarSistemaEstavel, versao } from "./verificarTexto";

/**
 * 29/09/2026, achado do Gustavo em produção: a recomendação de `avaliarTema`
 * (instrução de como gravar o tema ajustado) foi reprovada duas vezes pelo
 * verificador como "briefing de direção de gravação". O gênero "tema" diz ao
 * modelo barato que instrução de gravação é o formato certo desse texto.
 */
describe("verificarTexto, gênero tema", () => {
  it("o gênero tema explica que instrução de gravação é o formato esperado, e não confunde com briefing interno", () => {
    const sistema = montarSistemaEstavel("tema");
    expect(sistema).toContain("recomendação sobre um tema");
    expect(sistema).toContain("Instrução de gravação é o formato certo deste gênero");
    expect(sistema).toContain("não um briefing interno");
  });

  it("o gênero padrão continua sem essa explicação (só tom de pessoa falando com pessoa)", () => {
    const sistema = montarSistemaEstavel();
    expect(sistema).toContain("uma pessoa falando com outra pessoa");
    expect(sistema).not.toContain("recomendação sobre um tema");
  });
});

describe("verificarTexto com fontes (o roteiro não inventa fato, 04/10/2026)", () => {
  it("sem fontes nada muda: nem o critério de fato, nem o bloco FONTES", () => {
    expect(montarSistemaEstavel("roteiro")).not.toContain("FONTES");
    expect(montarEntrada({ texto: "t", proibicoes: [] })).not.toContain("FONTES");
  });

  it("com fontes, o sistema reprova fato concreto fora delas, aceita o espaço marcado entre colchetes e não pede que o jeito de falar esteja nas fontes", () => {
    const sistema = montarSistemaEstavel("roteiro", true);
    expect(versao).toBe("1.6.0");
    expect(sistema).toContain("não afirma nenhum fato concreto");
    expect(sistema).toContain("[diga aqui onde você está]");
    expect(sistema).toContain("não é fato, é o certo");
    expect(sistema).toContain("o jeito de falar, a estrutura e as instruções de gravação não precisam estar nas fontes");
  });

  it("a entrada leva as fontes depois do texto e das proibições", () => {
    const entrada = montarEntrada({ texto: "o texto", proibicoes: ["x"], fontes: "o momento: na oficina" });
    expect(entrada.indexOf("o texto")).toBeLessThan(entrada.indexOf("FONTES"));
    expect(entrada).toContain("o momento: na oficina");
  });
});
