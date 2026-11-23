/**
 * A frase do erro da IA para a sessão (achado de 05/10/2026): admin na sessão real lê a causa; qualquer outro lê a do cliente (a do problema nosso nas causas que trancam), e o erro sem causa, a genérica; sem sessão legível, a genérica.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessaoAtual } = vi.hoisted(() => ({ sessaoAtual: vi.fn() }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual }));

import { ErroIA, FRASE_DO_PROBLEMA_NOSSO, FRASE_GENERICA_DO_CLIENTE } from "@/ia/erro";

import { fraseDoErroDaIAParaASessao } from "./erro-ia-da-sessao";

const credito = () => new ErroIA("credit balance is too low", undefined, "credito");

beforeEach(() => {
  sessaoAtual.mockReset();
});

describe("fraseDoErroDaIAParaASessao", () => {
  it("o admin na sessão real lê a causa", async () => {
    sessaoAtual.mockResolvedValue({ user: { role: "admin" } });
    expect(await fraseDoErroDaIAParaASessao(credito())).toBe("A API da IA está sem crédito. Recarregue em Plans & Billing da Anthropic.");
  });

  it("o cliente comum lê a frase do problema nosso (a causa trava a IA para todos)", async () => {
    sessaoAtual.mockResolvedValue({ user: { role: "cliente" } });
    expect(await fraseDoErroDaIAParaASessao(credito())).toBe(FRASE_DO_PROBLEMA_NOSSO);
    sessaoAtual.mockResolvedValue({ user: { role: null } });
    expect(await fraseDoErroDaIAParaASessao(credito())).toBe(FRASE_DO_PROBLEMA_NOSSO);
  });

  it("sem sessão, ou com a leitura da sessão falhando, a frase é a genérica", async () => {
    sessaoAtual.mockResolvedValue(null);
    expect(await fraseDoErroDaIAParaASessao(credito())).toBe(FRASE_DO_PROBLEMA_NOSSO);
    sessaoAtual.mockRejectedValue(new Error("fora de um pedido"));
    expect(await fraseDoErroDaIAParaASessao(credito())).toBe(FRASE_DO_PROBLEMA_NOSSO);
  });

  it("o erro sem causa nem lê a sessão", async () => {
    expect(await fraseDoErroDaIAParaASessao(new ErroIA("saida truncada"))).toBe(FRASE_GENERICA_DO_CLIENTE);
    expect(sessaoAtual).not.toHaveBeenCalled();
  });
});
