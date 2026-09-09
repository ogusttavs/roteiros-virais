import { describe, expect, it } from "vitest";

import { mascararSegredos } from "./log";

describe("mascararSegredos", () => {
  it("mascara uma string que e so o token", () => {
    expect(mascararSegredos("EAAsegredoqualquer123")).toBe("***token mascarado***");
  });

  it("nao mexe em string sem nenhum EAA", () => {
    expect(mascararSegredos("erro qualquer")).toBe("erro qualquer");
  });

  /**
   * Ajuste 3 da revisao do PR #35: o token vai na URL da Graph API
   * (`access_token=EAA...`), e a mascara antiga (`startsWith`) nunca cobria
   * um erro que logasse a URL inteira, com texto antes do token.
   */
  it("mascara o token no meio de uma url, mantendo o resto", () => {
    const url = "https://graph.facebook.com/v26.0/123?fields=x&access_token=EAAxyz123ABC&outro=1";
    expect(mascararSegredos(url)).toBe(
      "https://graph.facebook.com/v26.0/123?fields=x&access_token=***token mascarado***&outro=1",
    );
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

  it("mascara o token quando ele aparece na mensagem do erro, mantendo o resto do texto (mascara por trecho, ajuste 3 da revisao do PR #35)", () => {
    const erro = new Error("token invalido: EAAtoken123ABC");
    const resultado = mascararSegredos(erro) as { mensagem: string };
    expect(resultado.mensagem).toBe("token invalido: ***token mascarado***");
  });

  it("Error dentro de um objeto (formato do logger.error({ err: erro })) tambem preserva a mensagem", () => {
    const resultado = mascararSegredos({ err: new Error("erro interno") }) as { err: { mensagem: string } };
    expect(resultado.err.mensagem).toBe("erro interno");
  });
});
