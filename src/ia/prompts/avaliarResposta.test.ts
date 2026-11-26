/**
 * H2 (achado do Gustavo em 29/09/2026, briefing da Overtake Pro): o critério "Concreto" deixou
 * de pedir nome de pessoa, e uma regra dura nova proíbe pedir dado que identifique um cliente
 * de verdade.
 */
import { describe, expect, it } from "vitest";

import { MARCA_DA_FONTE, montarEntrada, montarSistemaEstavel } from "./avaliarResposta";

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

/** E76 PR 1: a sugestão de resposta não inventa dado; as fontes da marca vão na entrada, com a marca de cada uma. */
describe("1.7.0, os fatos travados no exemplo", () => {
  const sistema = montarSistemaEstavel();

  it("o sistema proíbe afirmar o que não está nas fontes e manda o que falta para um colchete em forma de pergunta", () => {
    expect(sistema).toContain("Fatos travados no exemplo");
    expect(sistema).toContain("que não esteja escrito nas FONTES DA MARCA");
    expect(sistema.replace(/\s+/g, " ")).toContain("Nunca estime, nunca arredonde");
    expect(sistema.replace(/\s+/g, " ")).toContain("vira um espaço entre colchetes escrito como pergunta curta");
    expect(sistema).toContain("Nunca escreva o dado no lugar do colchete.");
    for (const marca of Object.values(MARCA_DA_FONTE)) expect(sistema).toContain(marca);
  });

  it("a entrada traz as outras respostas e o que lemos do site e das redes, cada item com a marca da fonte, antes da resposta", () => {
    const entrada = montarEntrada({
      pergunta: "O que o seu negócio faz?",
      oQueAIAProcura: "um exemplo concreto",
      resposta: "Cuidamos da importação inteira.",
      outrasRespostas: [
        { enunciado: "O que você vende?", resposta: "Importação de máquinas pequenas." },
        { enunciado: "Pergunta sem resposta", resposta: "  " },
      ],
      lidoDaMarca: [
        { origem: "site", texto: "Importadora que atua desde 2019." },
        { origem: "instagram", texto: "Posta os pedidos chegando no galpão." },
      ],
    });
    expect(entrada).toContain("FONTES DA MARCA");
    expect(entrada).toContain("- O que você vende?: Importação de máquinas pequenas.");
    expect(entrada).not.toContain("Pergunta sem resposta");
    expect(entrada).toContain("- (do seu site) Importadora que atua desde 2019.");
    expect(entrada).toContain("- (do seu Instagram) Posta os pedidos chegando no galpão.");
    expect(entrada.indexOf("FONTES DA MARCA")).toBeLessThan(entrada.indexOf("Resposta do cliente:"));
    // O lembrete de acentuação continua sendo a última linha (1.6.1).
    expect(entrada.trimEnd().endsWith("mesmo que a resposta do cliente esteja sem acento.")).toBe(true);
  });

  it("sem outra fonte, a entrada diz que só há a resposta do cliente", () => {
    const entrada = montarEntrada({ pergunta: "P", oQueAIAProcura: "Q", resposta: "R" });
    expect(entrada).toContain("- Nenhuma além da resposta do cliente abaixo.");
  });

  it("uma resposta longa entra cortada, numa linha só", () => {
    const longa = `${"palavra ".repeat(200)}
segunda linha`;
    const entrada = montarEntrada({ pergunta: "P", oQueAIAProcura: "Q", resposta: "R", outrasRespostas: [{ enunciado: "E", resposta: longa }] });
    const linha = entrada.split(String.fromCharCode(10)).find((l) => l.startsWith("- E: "))!;
    expect(linha.length).toBeLessThan(520);
    expect(linha.endsWith("...")).toBe(true);
  });
});
