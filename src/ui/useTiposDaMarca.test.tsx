/** O estado dos tipos de vídeo do cliente (E46 PR 1, item 0 do #119): a volta de uma troca que falha e a página que recarrega. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const responder = vi.fn();
vi.mock("@/app/(painel)/_casca/formatos-acoes", () => ({ responderFormatosAction: (...args: unknown[]) => responder(...args) }));

import { useTiposDaMarca } from "./useTiposDaMarca";

beforeEach(() => responder.mockReset());
afterEach(cleanup);

describe("useTiposDaMarca", () => {
  it("uma troca que falha volta para o que a chave era antes do clique", async () => {
    responder.mockResolvedValue(false);
    const { result } = renderHook(() => useTiposDaMarca([{ chave: "lista", ligada: true }]));
    expect(result.current.estado.lista).toBe(true);
    await act(async () => {
      await result.current.trocar("lista", false);
    });
    expect(result.current.estado.lista).toBe(true);
    expect(result.current.erro).not.toBeNull();
  });

  it("dois cliques seguidos em chaves diferentes: a falha de um não apaga o outro", async () => {
    let soltaPrimeira: (v: boolean) => void = () => {};
    responder.mockImplementationOnce(() => new Promise<boolean>((r) => (soltaPrimeira = r)));
    responder.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useTiposDaMarca([]));
    const antesBastidor = result.current.estado.bastidor;
    const antesLista = result.current.estado.lista;
    let primeira: Promise<void> = Promise.resolve();
    act(() => {
      primeira = result.current.trocar("lista", !antesLista);
    });
    await act(async () => {
      await result.current.trocar("bastidor", !antesBastidor);
    });
    await act(async () => {
      soltaPrimeira(false);
      await primeira;
    });
    expect(result.current.estado.lista).toBe(antesLista);
    expect(result.current.estado.bastidor).toBe(!antesBastidor);
  });

  it("dois cliques seguidos na mesma chave: o primeiro grava, o último falha antes dele voltar; no fim a tela mostra o que o servidor guardou (o do primeiro)", async () => {
    let soltaPrimeira: (v: boolean) => void = () => {};
    responder.mockImplementationOnce(() => new Promise<boolean>((r) => (soltaPrimeira = r)));
    responder.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useTiposDaMarca([{ chave: "lista", ligada: true }]));
    let primeira: Promise<void> = Promise.resolve();
    act(() => {
      primeira = result.current.trocar("lista", false);
    });
    await act(async () => {
      await result.current.trocar("lista", true);
    });
    await act(async () => {
      soltaPrimeira(true);
      await primeira;
    });
    expect(result.current.estado.lista).toBe(false);
  });

  it("quando o servidor manda outra lista (a página recarregou), ela vale de novo", () => {
    const { result, rerender } = renderHook(({ iniciais }) => useTiposDaMarca(iniciais), { initialProps: { iniciais: [{ chave: "lista", ligada: false }] } });
    expect(result.current.estado.lista).toBe(false);
    rerender({ iniciais: [{ chave: "lista", ligada: true }] });
    expect(result.current.estado.lista).toBe(true);
  });
});
