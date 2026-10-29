import { describe, expect, it } from "vitest";

import type { PalavraFalada } from "./tipos";
import { distanciaDeEdicao, linhasDaTranscricao, normalizar, palavraParaPrompt, textoDosIndices } from "./transcricao";

const p = (texto: string, inicio: number, fim: number): PalavraFalada => ({ texto, inicio, fim });

describe("linhasDaTranscricao", () => {
  it("uma palavra por linha com o índice e o início, e uma linha de pausa só onde o vão passa de 0,7 s", () => {
    const linhas = linhasDaTranscricao([p("Oi", 0.5, 0.8), p("gente", 0.9, 1.3), p("Vamos", 2.6, 3.0)]).split("\n");
    expect(linhas).toEqual(["0|0.5|Oi", "1|0.9|gente", "~ pausa de 1.3 s", "2|2.6|Vamos"]);
  });

  it("o índice é a posição na lista e a palavra limpa de separador e marcação nunca tira ou junta linha", () => {
    const linhas = linhasDaTranscricao([p("a|b", 0, 0.2), p("<x>\nfim", 0.3, 0.5), p("", 0.6, 0.7)]).split("\n");
    expect(linhas).toEqual(["0|0.0|a b", "1|0.3|x fim", "2|0.6|"]);
  });
});

describe("textos", () => {
  it("palavraParaPrompt tira o que quebraria a linha", () => {
    expect(palavraParaPrompt("  oi|<tchau>\t\n")).toBe("oi tchau");
  });
  it("textoDosIndices junta as palavras dos índices", () => {
    expect(textoDosIndices([p("a", 0, 1), p("b", 1, 2), p("c", 2, 3)], [0, 2])).toBe("a c");
  });
  it("normalizar tira acento, maiúscula e pontuação", () => {
    expect(normalizar("  Café, NÃO!  ")).toBe("cafe nao");
    expect(normalizar("Dr.Wash")).toBe("dr wash");
  });
  it("distanciaDeEdicao conta letras trocadas, tiradas e postas", () => {
    expect(distanciaDeEdicao("wash", "wash")).toBe(0);
    expect(distanciaDeEdicao("uosh", "wash")).toBe(2);
    expect(distanciaDeEdicao("sorriso", "sorrizo")).toBe(1);
    expect(distanciaDeEdicao("", "abc")).toBe(3);
  });
});
