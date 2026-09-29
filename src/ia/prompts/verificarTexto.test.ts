import { describe, expect, it } from "vitest";

import { montarSistemaEstavel } from "./verificarTexto";

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
