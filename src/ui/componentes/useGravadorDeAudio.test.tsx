/**
 * `useGravadorDeAudio` (P2, item 1): os estados do gancho (inicial, gravando, transcrevendo, sem
 * microfone, os dois erros), com `MediaRecorder`, `getUserMedia` e `fetch` falsos (jsdom não
 * implementa nenhum dos três de verdade), mesmo espírito de `useTeclado.test.tsx` (H3, item 2).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGravadorDeAudio } from "./useGravadorDeAudio";

/** `aoCriar` (em vez de o teste herdar a classe so para capturar a instancia): evita alias de `this`. */
let aoCriarGravadorFalso: (gravador: MediaRecorderFalso) => void = () => {};

class MediaRecorderFalso {
  static isTypeSupported = vi.fn().mockReturnValue(true);
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  private dados: Blob[];

  constructor(
    public stream: { getTracks: () => { stop: () => void }[] },
    public opcoes: { mimeType: string },
  ) {
    this.dados = [new Blob(["audio de mentira"], { type: opcoes.mimeType })];
    aoCriarGravadorFalso(this);
  }

  /** Um teste troca isto para simular gravação vazia (o caso `audioVazio`). */
  proximoBlobVazio = false;

  start() {}

  stop() {
    const blob = this.proximoBlobVazio ? new Blob([], { type: this.opcoes.mimeType }) : this.dados[0];
    this.ondataavailable?.({ data: blob });
    this.stream.getTracks().forEach((faixa) => faixa.stop());
    this.onstop?.();
  }
}

let getUserMediaMock: ReturnType<typeof vi.fn>;
let ultimoGravador: MediaRecorderFalso | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function faixaFalsa() {
  return { stop: vi.fn() };
}

beforeEach(() => {
  ultimoGravador = null;
  aoCriarGravadorFalso = (gravador) => {
    ultimoGravador = gravador;
  };
  getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [faixaFalsa()] });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: getUserMediaMock },
    configurable: true,
  });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MediaRecorderFalso;
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transcricao: "o texto que a pessoa falou" }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useGravadorDeAudio", () => {
  it("comeca no estado inicial, sem erro e sem segundos", () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    expect(result.current.fase).toBe("inicial");
    expect(result.current.segundos).toBe(0);
    expect(result.current.semMicrofone).toBe(false);
    expect(result.current.erro).toBeNull();
  });

  it("iniciarGravacao pede o microfone e vai para o estado gravando", async () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(result.current.fase).toBe("gravando");
  });

  it("pararGravacao chama a rota, organiza a fase como transcrevendo e depois volta a inicial com o texto", async () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ nomeArquivo: "briefing", onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(result.current.fase).toBe("inicial"));
    expect(fetchMock).toHaveBeenCalledWith("/api/transcrever", expect.objectContaining({ method: "POST" }));
    const forma = fetchMock.mock.calls[0][1].body as FormData;
    expect((forma.get("audio") as File).name).toBe("briefing.webm");
    expect(onTranscrito).toHaveBeenCalledWith("o texto que a pessoa falou", expect.any(Number));
    expect(result.current.erro).toBeNull();
  });

  it("sem MediaRecorder disponivel (aparelho sem suporte), marca semMicrofone e nunca chama getUserMedia", async () => {
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = undefined;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(result.current.semMicrofone).toBe(true);
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("getUserMedia recusado (permissao negada) marca semMicrofone", async () => {
    getUserMediaMock.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(result.current.semMicrofone).toBe(true);
    expect(result.current.fase).toBe("inicial");
  });

  it("gravacao vazia (blob sem bytes) vira erro audioVazio, sem chamar a rota nem onTranscrito", async () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    ultimoGravador!.proximoBlobVazio = true;

    act(() => {
      result.current.pararGravacao();
    });

    expect(result.current.erro).toBe("audioVazio");
    expect(result.current.fase).toBe("inicial");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onTranscrito).not.toHaveBeenCalled();
  });

  it("a rota responde com erro: vira falhaTranscricao, sem chamar onTranscrito", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ erro: "nao conseguimos entender o audio agora, tente de novo" }) });
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(result.current.erro).toBe("falhaTranscricao"));
    expect(result.current.fase).toBe("inicial");
    expect(onTranscrito).not.toHaveBeenCalled();
  });

  it("a rede cai no meio da chamada: tambem vira falhaTranscricao, sem estourar", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED simulado"));
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(result.current.erro).toBe("falhaTranscricao"));
    expect(onTranscrito).not.toHaveBeenCalled();
  });

  it("iniciar uma gravacao nova limpa o erro da tentativa anterior", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ erro: "falhou" }) });
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      result.current.pararGravacao();
    });
    await waitFor(() => expect(result.current.erro).toBe("falhaTranscricao"));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(result.current.erro).toBeNull();
  });
});
