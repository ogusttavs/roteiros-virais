/**
 * `useMarcasDeFala` (E41 parte 2b): o estado das marcas nas duas telas. Um pedido por vez, nada de pedido onde não dá para escrever (Story, vídeo sem fala, "ver como", marcas já
 * prontas), o pedido em segundo plano não mostra erro, e um texto que mudou descarta a resposta de um pedido que ficou para trás.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FalaDoRoteiro, MarcasParaATela } from "@/lib/marcas-de-fala";

const { marcarFalaAction } = vi.hoisted(() => ({ marcarFalaAction: vi.fn() }));
vi.mock("./acoes", () => ({ marcarFalaAction }));

import { useMarcasDeFala } from "./useMarcasDeFala";

const MARCAS: MarcasParaATela = {
  blocos: [{ bloco: "gancho", marcado: "Oi.{//}", tom: "direto" }],
  avisos: [],
};
const OUTRAS: MarcasParaATela = {
  blocos: [{ bloco: "gancho", marcado: "Olá.{//}", tom: "perto" }],
  avisos: [],
};

function fala(extra: Partial<FalaDoRoteiro> = {}): FalaDoRoteiro {
  return { podeMarcar: true, somenteLeitura: false, marcas: null, ...extra };
}

/** Um pedido que só termina quando o teste manda. */
function pedidoPendente() {
  let resolver!: (valor: unknown) => void;
  const promessa = new Promise((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

beforeEach(() => {
  marcarFalaAction.mockReset();
});
afterEach(cleanup);

describe("useMarcasDeFala", () => {
  it("pede uma vez, mostra 'marcando' enquanto espera e guarda as marcas que chegam", async () => {
    const pendente = pedidoPendente();
    marcarFalaAction.mockReturnValueOnce(pendente.promessa);
    const { result } = renderHook(() => useMarcasDeFala(7, fala(), "texto-1"));
    expect(result.current.estado).toBe("ociosa");
    expect(result.current.marcas).toBeNull();

    act(() => result.current.pedir());
    expect(marcarFalaAction).toHaveBeenCalledWith(7);
    expect(result.current.estado).toBe("marcando");
    // Um segundo pedido com o primeiro correndo não faz nada.
    act(() => result.current.pedir());
    expect(marcarFalaAction).toHaveBeenCalledTimes(1);

    await act(async () => pendente.resolver({ ok: true, dado: { marcas: MARCAS, motivo: null, novas: true } }));
    await waitFor(() => expect(result.current.marcas).toEqual(MARCAS));
    expect(result.current.estado).toBe("ociosa");
    expect(result.current.erro).toBeNull();
  });

  it("com as marcas já prontas, ou onde não dá para escrever, não pede nada", () => {
    const prontas = renderHook(() => useMarcasDeFala(7, fala({ marcas: MARCAS }), "t"));
    act(() => prontas.result.current.pedir());
    const story = renderHook(() => useMarcasDeFala(7, fala({ podeMarcar: false }), "t"));
    act(() => story.result.current.pedir());
    const verComo = renderHook(() => useMarcasDeFala(7, fala({ somenteLeitura: true }), "t"));
    act(() => verComo.result.current.pedir());
    expect(marcarFalaAction).not.toHaveBeenCalled();
    expect(prontas.result.current.marcas).toEqual(MARCAS);
  });

  it("o pedido de quem ligou a chave mostra a frase do erro; o de segundo plano não mostra nada", async () => {
    marcarFalaAction.mockResolvedValueOnce({ ok: false, erro: "Não consegui marcar a fala agora." });
    const { result } = renderHook(() => useMarcasDeFala(7, fala(), "t"));
    act(() => result.current.pedir());
    await waitFor(() => expect(result.current.erro).toBe("Não consegui marcar a fala agora."));
    expect(result.current.estado).toBe("ociosa");

    marcarFalaAction.mockResolvedValueOnce({ ok: false, erro: "Outra frase." });
    const quieto = renderHook(() => useMarcasDeFala(7, fala(), "t"));
    act(() => quieto.result.current.pedir({ emSegundoPlano: true }));
    await waitFor(() => expect(marcarFalaAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(quieto.result.current.estado).toBe("ociosa"));
    expect(quieto.result.current.erro).toBeNull();
  });

  it("depois de uma falha dá para pedir de novo", async () => {
    marcarFalaAction.mockResolvedValueOnce({ ok: false, erro: "falhou" });
    const { result } = renderHook(() => useMarcasDeFala(7, fala(), "t"));
    act(() => result.current.pedir());
    await waitFor(() => expect(result.current.erro).toBe("falhou"));
    marcarFalaAction.mockResolvedValueOnce({ ok: true, dado: { marcas: MARCAS, motivo: null, novas: true } });
    act(() => result.current.pedir());
    await waitFor(() => expect(result.current.marcas).toEqual(MARCAS));
    expect(result.current.erro).toBeNull();
  });

  it("o texto que mudou descarta a resposta de um pedido que ficou para trás e recomeça do que o servidor mandou", async () => {
    const velho = pedidoPendente();
    marcarFalaAction.mockReturnValueOnce(velho.promessa);
    const { result, rerender } = renderHook(({ chave, f }) => useMarcasDeFala(7, f, chave), { initialProps: { chave: "texto-antigo", f: fala() } });
    act(() => result.current.pedir());
    expect(result.current.estado).toBe("marcando");

    // A pessoa editou o texto: a tela recebe o roteiro novo, sem marcas.
    rerender({ chave: "texto-novo", f: fala() });
    expect(result.current.estado).toBe("ociosa");
    expect(result.current.marcas).toBeNull();

    // A resposta do texto antigo chega tarde e não vale.
    await act(async () => velho.resolver({ ok: true, dado: { marcas: MARCAS, motivo: null, novas: true } }));
    expect(result.current.marcas).toBeNull();

    // E o texto novo pode pedir o seu.
    marcarFalaAction.mockResolvedValueOnce({ ok: true, dado: { marcas: OUTRAS, motivo: null, novas: true } });
    act(() => result.current.pedir());
    await waitFor(() => expect(result.current.marcas).toEqual(OUTRAS));
  });

  it("depois de editar um texto que tinha marcas, no mesmo quadro as marcas velhas saem e dá para pedir as novas", async () => {
    marcarFalaAction.mockResolvedValueOnce({ ok: true, dado: { marcas: OUTRAS, motivo: null, novas: true } });
    const { result, rerender } = renderHook(({ chave, f }) => useMarcasDeFala(7, f, chave), { initialProps: { chave: "texto-antigo", f: fala({ marcas: MARCAS }) } });
    expect(result.current.marcas).toEqual(MARCAS);

    rerender({ chave: "texto-novo", f: fala({ marcas: null }) });
    // Nem um quadro com as marcas do texto antigo sobre o texto novo.
    expect(result.current.marcas).toBeNull();
    act(() => result.current.pedir({ emSegundoPlano: true }));
    expect(marcarFalaAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.marcas).toEqual(OUTRAS));
  });

  it("as marcas que chegaram por um pedido valem só para o texto de que saíram", async () => {
    marcarFalaAction.mockResolvedValueOnce({ ok: true, dado: { marcas: MARCAS, motivo: null, novas: true } });
    const { result, rerender } = renderHook(({ chave }) => useMarcasDeFala(7, fala(), chave), { initialProps: { chave: "texto-antigo" } });
    act(() => result.current.pedir());
    await waitFor(() => expect(result.current.marcas).toEqual(MARCAS));

    // O texto mudou: as marcas que tinham chegado não valem para o texto novo, nem por um quadro.
    rerender({ chave: "texto-novo" });
    expect(result.current.marcas).toBeNull();
    // E voltando ao texto de antes (um "desfazer"), elas voltam a valer: são as dele.
    rerender({ chave: "texto-antigo" });
    expect(result.current.marcas).toEqual(MARCAS);
  });

  it("a chave ligada com o pedido de segundo plano ainda correndo: a espera e o erro passam a ser dela", async () => {
    const pendente = pedidoPendente();
    marcarFalaAction.mockReturnValueOnce(pendente.promessa);
    const { result } = renderHook(() => useMarcasDeFala(7, fala(), "t"));
    act(() => result.current.pedir({ emSegundoPlano: true }));
    act(() => result.current.pedir());
    expect(marcarFalaAction).toHaveBeenCalledTimes(1);
    expect(result.current.estado).toBe("marcando");

    await act(async () => pendente.resolver({ ok: false, erro: "Não consegui marcar a fala agora." }));
    await waitFor(() => expect(result.current.erro).toBe("Não consegui marcar a fala agora."));
    expect(result.current.estado).toBe("ociosa");
  });

  it("as marcas do texto antigo saem de cena quando o texto muda e o servidor manda o roteiro sem marcas", () => {
    const { result, rerender } = renderHook(({ chave, f }) => useMarcasDeFala(7, f, chave), { initialProps: { chave: "texto-antigo", f: fala({ marcas: MARCAS }) } });
    expect(result.current.marcas).toEqual(MARCAS);
    rerender({ chave: "texto-novo", f: fala({ marcas: null }) });
    expect(result.current.marcas).toBeNull();
  });

  it("'editado no meio' (o texto mudou durante a marcação) mostra a frase para quem ligou a chave", async () => {
    marcarFalaAction.mockResolvedValueOnce({ ok: true, dado: { marcas: null, motivo: "editado_no_meio", novas: false } });
    const { result } = renderHook(() => useMarcasDeFala(7, fala(), "t"));
    act(() => result.current.pedir());
    await waitFor(() => expect(result.current.erro).not.toBeNull());
    expect(result.current.marcas).toBeNull();
  });
});
