import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { intercalarSemRepetir, limparCanaisSugeridos, limparTermosDoFoco } from "./pesquisa-do-foco";

describe("limparTermosDoFoco", () => {
  it("fica com frases de 2 a 6 palavras, sem repetir, sem aspas nem hashtag", () => {
    const saida = limparTermosDoFoco(["automação com IA", "Automação com ia", "#marketing", "\"vender mais\" no zap", "dicas", "uma frase com palavras demais para uma busca"]);
    expect(saida).toEqual(["automação com IA", "vender mais no zap"]);
  });

  it("não passa de seis frases", () => {
    const muitas = Array.from({ length: 8 }, (_, i) => `assunto número ${i} aqui`);
    expect(limparTermosDoFoco(muitas)).toHaveLength(6);
  });

  it("recusa palavra solta, que traz qualquer vídeo", () => {
    expect(limparTermosDoFoco(["brasil", "notícias"])).toEqual([]);
  });
});

describe("limparCanaisSugeridos", () => {
  it("devolve só o que parece um @ de canal, com o @ na frente e sem repetir", () => {
    const saida = limparCanaisSugeridos(["canalexemplo", "@CanalExemplo", "@@", "ab", "canal com espaço", "https://youtube.com/@x", "@outro.canal_1"]);
    expect(saida).toEqual(["@canalexemplo", "@outro.canal_1"]);
  });

  it("não passa de cinco canais", () => {
    const muitos = Array.from({ length: 9 }, (_, i) => `@canal${i}abc`);
    expect(limparCanaisSugeridos(muitos)).toHaveLength(5);
  });
});

describe("intercalarSemRepetir", () => {
  it("divide as vagas entre as fontes na vez e respeita o limite", () => {
    expect(intercalarSemRepetir([["a1", "a2", "a3"], ["b1", "b2"]], 4)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("não repete o mesmo vídeo vindo de duas fontes", () => {
    expect(intercalarSemRepetir([["x", "y"], ["x", "z"]], 10)).toEqual(["x", "z", "y"]);
  });

  it("limite zero ou fontes vazias não devolvem nada", () => {
    expect(intercalarSemRepetir([["a"]], 0)).toEqual([]);
    expect(intercalarSemRepetir([[], []], 5)).toEqual([]);
  });

  it("uma fonte esgotada deixa as outras usarem as vagas", () => {
    expect(intercalarSemRepetir([["a1"], ["b1", "b2", "b3"]], 4)).toEqual(["a1", "b1", "b2", "b3"]);
  });
});

describe("nenhum caminho da pesquisa do foco usa a Apify", () => {
  it("nem o serviço, nem o job, nem o prompt importam ou citam a Apify", () => {
    for (const arquivo of ["src/servicos/pesquisa-do-foco.ts", "src/jobs/pesquisa-do-foco.ts", "src/ia/prompts/derivarBuscaDoFoco.ts"]) {
      const texto = readFileSync(arquivo, "utf-8");
      const importacoes = texto.split("\n").filter((linha) => linha.startsWith("import"));
      expect(importacoes.filter((linha) => /apify/i.test(linha)), arquivo).toEqual([]);
      expect(texto, arquivo).not.toMatch(/apify-api|coletaApify|rodarColetaApify/);
    }
  });
});
