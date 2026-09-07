import { describe, expect, it } from "vitest";

import { pareceTextoEmPortugues } from "./idioma";

/** Os 20 trechos em inglês do comentário de revisão do PR #30 (Fable, contra 27 análises reais de produção). */
const TRECHOS_EM_INGLES = [
  "Just pour vinegar on your feet and wait. What happens next will leave you speechless.",
  "Mix toothpaste with Vaseline and you'll never look at either of them the same way again.",
  "Stop! Look at this disgusting patio chair!",
  "Rate this tip from 0 to 10. I'd love to know what you think.",
  "Now here's the part that'll end up dripping some water.",
  "Have you ever tried this simple finger movement?",
  "After this, even the stinkiest room will smell incredible.",
  "Like this video, share it with your friends And tell me in the comments what you cleaned first",
];

/** Trechos em português que a versão anterior (proporção de 8 palavras) reprovava errado. */
const TRECHOS_EM_PORTUGUES = [
  "O vídeo encerra orientando a tentar o banho à noite e promete que a pessoa sentirá a diferença.",
  "Tente a noite e sinta a diferença.",
  "O mofo vai sumir e dificilmente vai retornar.",
  "Pergunte aqui caso tenha dúvidas sobre o tema.",
  "Agradece por assistir e abençoa o espectador.",
  "O vídeo finaliza mostrando o aerador limpo e funcionando melhor após a limpeza.",
  "Implícitamente convida a experimentar o truque ao mostrar o resultado final.",
  "O vídeo explica a diferença entre higienização e lavagem a seco, mostrando onde fica a sujidade no processo.",
];

describe("pareceTextoEmPortugues", () => {
  it.each(TRECHOS_EM_INGLES)("reprova o trecho real em ingles: %s", (trecho) => {
    expect(pareceTextoEmPortugues(trecho)).toBe(false);
  });

  it.each(TRECHOS_EM_PORTUGUES)("aprova o trecho real em portugues: %s", (trecho) => {
    expect(pareceTextoEmPortugues(trecho)).toBe(true);
  });

  it("aprova o caso misto (a segunda tentativa resolve, nao a checagem)", () => {
    expect(
      pareceTextoEmPortugues(
        "Este simples fabric softener e alcohol trick vai fazer a sua casa smell como um flor de flor em spring",
      ),
    ).toBe(true);
  });

  it("nao reprova texto curto demais para dar sinal confiavel (menos de 4 palavras)", () => {
    expect(pareceTextoEmPortugues("limpeza profunda")).toBe(true);
    expect(pareceTextoEmPortugues("clean the sofa")).toBe(true);
  });

  it("empate entre as duas listas aprova", () => {
    expect(pareceTextoEmPortugues("gancho, explicacao, demonstracao, fechamento")).toBe(true);
  });

  it("texto vazio nao reprova (nada para checar)", () => {
    expect(pareceTextoEmPortugues("")).toBe(true);
  });
});
