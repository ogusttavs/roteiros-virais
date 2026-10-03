/**
 * As Server Actions do aviso por push (A2, item 4): os argumentos vêm do navegador e só valem como strings não vazias; qualquer outra coisa devolve `false`
 * (ou não faz nada) sem lançar e sem chegar ao serviço. Sem sessão, nada passa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessaoAtual = vi.fn();
vi.mock("@/lib/sessao", () => ({ sessaoAtual: () => sessaoAtual() }));

const registrarInscricaoPush = vi.fn();
const apagarInscricaoDaPessoa = vi.fn();
vi.mock("@/servicos/push", () => ({
  adiarPedidoDePush: vi.fn(),
  apagarInscricaoDaPessoa: (...args: unknown[]) => apagarInscricaoDaPessoa(...args),
  registrarInscricaoPush: (...args: unknown[]) => registrarInscricaoPush(...args),
  ErroInscricaoPush: class ErroInscricaoPush extends Error {},
}));
vi.mock("@/servicos/clientes", () => ({ ErroAcessoNegado: class ErroAcessoNegado extends Error {} }));

import { apagarInscricaoPushAction, registrarInscricaoPushAction } from "./push-acoes";

const VALIDA = { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" };

beforeEach(() => {
  sessaoAtual.mockReset();
  sessaoAtual.mockResolvedValue({ user: { id: "pessoa-1" } });
  registrarInscricaoPush.mockReset();
  registrarInscricaoPush.mockResolvedValue({});
  apagarInscricaoDaPessoa.mockReset();
});

describe("registrarInscricaoPushAction", () => {
  it("argumentos válidos chegam ao serviço, com o usuário da sessão e o sistema (qualquer sistema desconhecido vira computador)", async () => {
    expect(await registrarInscricaoPushAction(VALIDA, "android")).toBe(true);
    expect(registrarInscricaoPush).toHaveBeenCalledWith("pessoa-1", VALIDA, "android");

    await registrarInscricaoPushAction(VALIDA, "windows");
    expect(registrarInscricaoPush).toHaveBeenLastCalledWith("pessoa-1", VALIDA, "computador");
  });

  it("tipo errado ou texto vazio devolve false sem lançar e sem chegar ao serviço", async () => {
    const ruins: [unknown, unknown][] = [
      [null, "android"],
      ["texto", "android"],
      [42, "android"],
      [{}, "android"],
      [{ ...VALIDA, endpoint: "" }, "android"],
      [{ ...VALIDA, endpoint: "   " }, "android"],
      [{ ...VALIDA, endpoint: 7 }, "android"],
      [{ ...VALIDA, p256dh: null }, "android"],
      [{ ...VALIDA, auth: ["a"] }, "android"],
      [{ ...VALIDA, auth: undefined }, "android"],
      [VALIDA, ""],
      [VALIDA, undefined],
      [VALIDA, { sistema: "android" }],
    ];
    for (const [dados, sistema] of ruins) {
      expect(await registrarInscricaoPushAction(dados, sistema)).toBe(false);
    }
    expect(registrarInscricaoPush).not.toHaveBeenCalled();
  });

  it("o serviço recusando a inscrição (endereço fora da lista, chaves de outra pessoa) volta false, e sem sessão a ação lança", async () => {
    const { ErroInscricaoPush } = await import("@/servicos/push");
    registrarInscricaoPush.mockRejectedValueOnce(new ErroInscricaoPush("recusada"));
    expect(await registrarInscricaoPushAction(VALIDA, "android")).toBe(false);

    sessaoAtual.mockResolvedValue(null);
    await expect(registrarInscricaoPushAction(VALIDA, "android")).rejects.toThrow();
  });
});

describe("apagarInscricaoPushAction", () => {
  it("só apaga com um endereço em texto; o resto é ignorado", async () => {
    await apagarInscricaoPushAction(VALIDA.endpoint);
    expect(apagarInscricaoDaPessoa).toHaveBeenCalledWith("pessoa-1", VALIDA.endpoint);

    apagarInscricaoDaPessoa.mockClear();
    for (const ruim of ["", "  ", null, undefined, 42, {}, ["x"]]) await apagarInscricaoPushAction(ruim);
    expect(apagarInscricaoDaPessoa).not.toHaveBeenCalled();
  });
});
