import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dadoOuErro, ErroDeAcao } from "@/lib/resultado-acao";

import { useTratarFalha } from "./ConexaoContext";

/**
 * A frase que o servidor devolve (`ResultadoAcao` com `ok: false`, aberta por `dadoOuErro`) chega inteira à tela: `useTratarFalha` a usa no lugar do texto genérico do lugar. Antes, o
 * "Não muda de dia: ..." da recusa do roteiro do momento morria no `catch` de cada tela, que mostrava "Não foi possível salvar" e deixava a pessoa tentar de novo para sempre (revisão do PR 2a da E55).
 */
describe("useTratarFalha e a frase do servidor", () => {
  it("dadoOuErro devolve o dado do resultado ok", () => {
    expect(dadoOuErro({ ok: true, dado: 7 })).toBe(7);
  });

  it("dadoOuErro lança um ErroDeAcao com a frase do servidor", () => {
    expect.assertions(2);
    try {
      dadoOuErro({ ok: false, erro: "Não muda de dia: o assunto do momento é para hoje." });
    } catch (falha) {
      expect(falha).toBeInstanceOf(ErroDeAcao);
      expect((falha as Error).message).toBe("Não muda de dia: o assunto do momento é para hoje.");
    }
  });

  it("a frase do servidor vence o texto genérico do lugar", () => {
    const { result } = renderHook(() => useTratarFalha());
    expect(result.current(new ErroDeAcao("Não muda de dia: o assunto do momento é para hoje."), "Não foi possível salvar. Tente de novo.")).toBe(
      "Não muda de dia: o assunto do momento é para hoje.",
    );
  });

  it("uma exceção qualquer continua caindo no texto genérico do lugar", () => {
    const { result } = renderHook(() => useTratarFalha());
    expect(result.current(new Error("boom"), "Não foi possível salvar. Tente de novo.")).toBe("Não foi possível salvar. Tente de novo.");
  });
});
