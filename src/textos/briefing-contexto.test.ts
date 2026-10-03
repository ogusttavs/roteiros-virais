/**
 * Os textos de "o que a IA tirou das suas redes e do seu site" (E38 PR 2) com datas fixas: a frase da leitura, e a regra de texto
 * (sem travessão, emoji, jargão) em cada frase nova. O e2e usa datas de hoje e monta a frase esperada por este mesmo texto, por isso
 * ele é conferido aqui com valores que não mudam.
 */
import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";

import { textosBriefing } from "./briefing";

const t = textosBriefing.contextoDaMarca;

describe("lidoEm", () => {
  const LIDO = new Date("2026-09-20T15:00:00Z");
  const PROXIMA = new Date("2026-10-20T15:00:00Z");

  it("lista só as fontes lidas, com o site por último, e anuncia a próxima leitura", () => {
    expect(t.lidoEm(LIDO, ["site", "instagram"], PROXIMA)).toBe("Lido em 20 de setembro, no Instagram e no site. A próxima leitura é em 20 de outubro.");
    expect(t.lidoEm(LIDO, ["youtube", "instagram", "site"], PROXIMA)).toBe("Lido em 20 de setembro, no YouTube, no Instagram e no site. A próxima leitura é em 20 de outubro.");
    expect(t.lidoEm(LIDO, ["site"], PROXIMA)).toBe("Lido em 20 de setembro, no site. A próxima leitura é em 20 de outubro.");
  });

  it("sem próxima leitura a prometer (a data já passou), a frase não diz nenhuma", () => {
    expect(t.lidoEm(LIDO, ["site"], null)).toBe("Lido em 20 de setembro, no site.");
  });
});

describe("as frases novas respeitam as regras de texto", () => {
  const frases: [string, string][] = [
    ["valiaAntes", t.valiaAntes],
    ["mudouEnquantoLia", t.mudouEnquantoLia],
    ["tiradosTitulo(1)", t.tiradosTitulo(1)],
    ["tiradosTitulo(3)", t.tiradosTitulo(3)],
    ["tiradosAjuda", t.tiradosAjuda],
    ["rotuloDaAcao", t.rotuloDaAcao(t.corrigir, "Vende removedor de manchas para tecido claro e atende pelo WhatsApp todos os dias")],
    ["anuncioConfirmado", t.anuncioConfirmado],
    ["anuncioCorrigido", t.anuncioCorrigido],
    ["anuncioTirado", t.anuncioTirado],
    ["anuncioDesfeito", t.anuncioDesfeito],
    ["contadorCorrecao", t.contadorCorrecao(10, 500)],
    ["textoLongo", t.textoLongo(500)],
    ["nadaSobrou", t.nadaSobrou],
    ["novidadeMudou", t.novidadeMudou],
    ["erroCorrigirSemTexto", t.erroCorrigirSemTexto],
    ["semConexaoCorrigirSemTexto", t.semConexaoCorrigirSemTexto],
    ["lendo", t.lendo],
    ["naoLeu", t.naoLeu],
    ["nadaClaro", t.nadaClaro],
  ];

  it.each(frases)("%s", (_nome, frase) => {
    expect(encontrarProblemas(frase)).toEqual([]);
  });

  it("o nome do botão corta o texto do item em 60 caracteres, sem deixar uma palavra pela metade sem aviso", () => {
    const longo = "Vende removedor de manchas para tecido claro e atende pelo WhatsApp todos os dias da semana";
    const nome = t.rotuloDaAcao("Está certo", longo);
    expect(nome.startsWith("Está certo: Vende removedor de manchas")).toBe(true);
    expect(nome.endsWith("...")).toBe(true);
    expect(nome.length).toBeLessThanOrEqual("Está certo: ".length + 60);
    expect(t.rotuloDaAcao("Tirar", "Texto curto.")).toBe("Tirar: Texto curto.");
  });

  it("tiradosTitulo concorda no singular e no plural", () => {
    expect(t.tiradosTitulo(1)).toBe("1 item que você tirou");
    expect(t.tiradosTitulo(2)).toBe("2 itens que você tirou");
  });
});
