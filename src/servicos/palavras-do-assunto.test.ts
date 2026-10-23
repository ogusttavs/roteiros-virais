import { describe, expect, it } from "vitest";

import { assuntoLimpo, assuntosEmAltaParaAcompanhar, limparPalavrasSugeridas, MAXIMO_DE_PALAVRAS_SUGERIDAS } from "./palavras-do-assunto";

describe("limparPalavrasSugeridas", () => {
  it("tira aspas, hashtag, travessão e quebra de linha, junta os espaços e apara", () => {
    expect(limparPalavrasSugeridas(['  "reforma  tributária" ', "#eleição", "dólar\nhoje", "crédito — consignado"])).toEqual(["reforma tributária", "eleição", "dólar hoje", "crédito consignado"]);
  });

  it("não repete (sem acento e sem maiúscula), mantém a primeira grafia e a ordem", () => {
    expect(limparPalavrasSugeridas(["Eleição", "eleicao", "ELEIÇÃO", "candidatos"])).toEqual(["Eleição", "candidatos"]);
  });

  it("descarta o curto demais, o comprido demais, o emoji e as palavras largas que trariam qualquer notícia", () => {
    const comprida = "a".repeat(41);
    expect(limparPalavrasSugeridas(["a", comprida, "reforma \u{1F525}", "notícias", "Hoje", "Brasil", "ao vivo", "Selic"])).toEqual(["Selic"]);
  });

  it("devolve no máximo seis", () => {
    const muitas = ["um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito"];
    expect(limparPalavrasSugeridas(muitas)).toHaveLength(MAXIMO_DE_PALAVRAS_SUGERIDAS);
    expect(limparPalavrasSugeridas(muitas)).toEqual(muitas.slice(0, 6));
  });
});

describe("assuntoLimpo", () => {
  it("junta os espaços e recusa o que é curto demais ou passa de 60 letras", () => {
    expect(assuntoLimpo("  feira   de adoção ")).toBe("feira de adoção");
    expect(assuntoLimpo("a")).toBeNull();
    expect(assuntoLimpo("   ")).toBeNull();
    expect(assuntoLimpo("x".repeat(61))).toBeNull();
    expect(assuntoLimpo("x".repeat(60))).toHaveLength(60);
  });
});

describe("assuntosEmAltaParaAcompanhar", () => {
  const item = (assunto: string, posicao: number, termos: string[], sensivel = false) => ({ chave: assunto.toLowerCase(), assunto, termos, posicao, sensivel });

  it("sem lista de agora, não há o que mostrar", () => {
    expect(assuntosEmAltaParaAcompanhar(null)).toEqual([]);
    expect(assuntosEmAltaParaAcompanhar({ assuntos: [] })).toEqual([]);
  });

  it("ordena pela posição, tira o delicado, põe o assunto na frente das palavras e respeita o limite", () => {
    const lista = {
      assuntos: [item("Terceiro", 3, ["c1"]), item("Delicado", 1, ["d1"], true), item("Segundo", 2, ["Segundo", "s1", "s2"]), item("Quarto", 4, [])],
    };
    const r = assuntosEmAltaParaAcompanhar(lista, 2);
    expect(r.map((a) => a.assunto)).toEqual(["Segundo", "Terceiro"]);
    expect(r[0].palavras).toEqual(["Segundo", "s1", "s2"]);
    expect(r[1].palavras).toEqual(["Terceiro", "c1"]);
  });

  it("assunto comprido é cortado em 60 letras e a palavra em 40", () => {
    const comprido = "palavra ".repeat(12).trim();
    const [a] = assuntosEmAltaParaAcompanhar({ assuntos: [item(comprido, 1, [])] });
    expect(a.assunto.length).toBeLessThanOrEqual(60);
    expect(a.palavras[0].length).toBeLessThanOrEqual(40);
  });
});
