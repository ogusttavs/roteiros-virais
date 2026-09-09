import { describe, expect, it } from "vitest";

import { mascararSegredos } from "./log";

describe("mascararSegredos", () => {
  it("mascara uma string que comeca com EAA", () => {
    expect(mascararSegredos("EAAsegredoqualquer123")).toBe("***token mascarado***");
  });

  it("nao mexe em string que nao comeca com EAA", () => {
    expect(mascararSegredos("erro qualquer")).toBe("erro qualquer");
  });

  it("mascara em qualquer profundidade de um objeto", () => {
    const objeto = {
      erro: "algo deu errado",
      contexto: { token: "EAAxyz", outro: { valor: "EAAoutravez" } },
    };
    expect(mascararSegredos(objeto)).toEqual({
      erro: "algo deu errado",
      contexto: { token: "***token mascarado***", outro: { valor: "***token mascarado***" } },
    });
  });

  it("mascara dentro de um array", () => {
    expect(mascararSegredos(["EAAum", "normal"])).toEqual(["***token mascarado***", "normal"]);
  });

  it("nao mexe em numero, booleano ou nulo", () => {
    expect(mascararSegredos(42)).toBe(42);
    expect(mascararSegredos(true)).toBe(true);
    expect(mascararSegredos(null)).toBeNull();
  });

  /**
   * Achado da leitura previa do Fable, correcao 2: `Object.entries(new
   * Error(...))` e vazio (mensagem e pilha nao sao enumeraveis), entao um
   * Error caindo no ramo generico de objeto virava `{}` e apagava a
   * mensagem e a pilha do log.
   */
  it("um Error vira nome, mensagem e pilha, em vez de sumir", () => {
    const erro = new Error("falha ao chamar a api");
    const resultado = mascararSegredos(erro) as { nome: string; mensagem: string; pilha?: string };
    expect(resultado.nome).toBe("Error");
    expect(resultado.mensagem).toBe("falha ao chamar a api");
    expect(resultado.pilha).toContain("Error: falha ao chamar a api");
  });

  it("mascara o token quando a mensagem do erro comeca com EAA", () => {
    const erro = new Error("EAAtoken-vazou-na-mensagem");
    const resultado = mascararSegredos(erro) as { mensagem: string };
    expect(resultado.mensagem).toBe("***token mascarado***");
  });

  it("Error dentro de um objeto (formato do logger.error({ err: erro })) tambem preserva a mensagem", () => {
    const resultado = mascararSegredos({ err: new Error("erro interno") }) as { err: { mensagem: string } };
    expect(resultado.err.mensagem).toBe("erro interno");
  });
});
