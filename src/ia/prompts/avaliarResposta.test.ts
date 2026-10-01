/**
 * H2 (achado do Gustavo em 29/09/2026, briefing da Overtake Pro): o critério "Concreto" deixou
 * de pedir nome de pessoa, e uma regra dura nova proíbe pedir dado que identifique um cliente
 * de verdade.
 */
import { describe, expect, it } from "vitest";

import { montarSistemaEstavel } from "./avaliarResposta";

describe("montarSistemaEstavel, criterio Concreto e a regra dura do H2", () => {
  const sistema = montarSistemaEstavel();

  it("o criterio Concreto nao exige nome de pessoa", () => {
    expect(sistema).toContain("Nome de pessoa nunca é exigido");
  });

  it("a regra dura proibe pedir nome, bairro, endereco ou telefone de um cliente de verdade", () => {
    expect(sistema).toContain("Nunca peça nome, bairro, endereço ou telefone que identifique um cliente de verdade");
    expect(sistema).toContain('cumpre "Concreto" sozinho');
  });

  it("quem atende mais de um publico e quem vende para empresa tem instrucao propria", () => {
    expect(sistema).toContain("quem atende mais de um público descreve os dois");
    expect(sistema).toContain("quem vende para empresa descreve quem decide");
  });

  it("o exemplo de 'como melhorar' tambem nunca inventa nome de pessoa", () => {
    expect(sistema).toContain('use "um cliente", "uma empresária"');
  });

  it("avisa que a resposta do cliente pode vir sem acento, mas a analise sai sempre acentuada", () => {
    expect(sistema).toContain("A resposta do cliente pode vir sem");
    expect(sistema).toContain("a sua análise sai sempre acentuada");
  });
});
