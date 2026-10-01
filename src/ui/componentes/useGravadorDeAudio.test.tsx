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
/**
 * P2b: sem `SpeechRecognition` no jsdom, cada `iniciarGravacao` cria DOIS `MediaRecorder` (o
 * principal e, logo em seguida, o primeiro pedaço da prévia por camada b). O principal é sempre o
 * primeiro criado nesse ciclo; os testes que precisam mexer nele usam `gravadorPrincipal()`.
 */
let gravadoresCriados: MediaRecorderFalso[] = [];
function gravadorPrincipal(): MediaRecorderFalso {
  return gravadoresCriados[0]!;
}

class MediaRecorderFalso {
  static isTypeSupported = vi.fn().mockReturnValue(true);
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  /** A camada b (P2b) confere `.state` antes de chamar `.stop()`, igual ao `MediaRecorder` real. */
  state: "inactive" | "recording" = "inactive";
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

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    const blob = this.proximoBlobVazio ? new Blob([], { type: this.opcoes.mimeType }) : this.dados[0];
    this.ondataavailable?.({ data: blob });
    this.stream.getTracks().forEach((faixa) => faixa.stop());
    this.onstop?.();
  }
}

let getUserMediaMock: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function faixaFalsa() {
  return { stop: vi.fn() };
}

beforeEach(() => {
  gravadoresCriados = [];
  aoCriarGravadorFalso = (gravador) => {
    gravadoresCriados.push(gravador);
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
  vi.useRealTimers();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  ReconhecimentoFalsoDeFala.proximaFalhaNoStart = false;
});

/**
 * Fake mínimo da Web Speech API (camada a da prévia, P2b). `ultimo` guarda a última instância
 * criada, para o teste disparar `onresult`/`onerror`/`onend` como se fosse o navegador.
 */
class ReconhecimentoFalsoDeFala {
  static ultimo: ReconhecimentoFalsoDeFala | null = null;
  /** M4, item 0a: a proxima instancia criada falha ao chamar `.start()` (simula o recomeco falhando). */
  static proximaFalhaNoStart = false;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((evento: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  stop = vi.fn();
  abort = vi.fn();
  start: () => void;

  constructor() {
    ReconhecimentoFalsoDeFala.ultimo = this;
    if (ReconhecimentoFalsoDeFala.proximaFalhaNoStart) {
      ReconhecimentoFalsoDeFala.proximaFalhaNoStart = false;
      this.start = vi.fn(() => {
        throw new Error("start falhou de proposito, so no teste");
      });
    } else {
      this.start = vi.fn();
    }
  }
}

function eventoDeFala(texto: string) {
  return { results: [{ 0: { transcript: texto }, isFinal: true }] };
}

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
    gravadorPrincipal().proximoBlobVazio = true;

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

describe("previa ao vivo (P2b)", () => {
  it("sem reconhecimento do navegador, a previa usa pedacos (camada b)", async () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    // O principal e, logo em seguida, o primeiro pedaco de 5s da camada b.
    expect(gravadoresCriados).toHaveLength(2);
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(false);

    // O pedaco se fecha sozinho aos 5s; aqui simulamos esse fechamento direto, sem esperar de verdade.
    await act(async () => {
      gravadoresCriados[1]!.stop();
    });

    await waitFor(() => expect(result.current.previa).toBe("o texto que a pessoa falou"));
  });

  it("pedacos somam na ordem certa mesmo se a resposta de rede do segundo chegar primeiro", async () => {
    vi.useFakeTimers();
    const onTranscrito = vi.fn();

    const resolucoes: Array<(valor: unknown) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolucoes.push(resolve);
        }),
    );

    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));
    await act(async () => {
      await result.current.iniciarGravacao();
    });
    // Os 5s do primeiro pedaco passam: ele se fecha sozinho e manda, e o intervalo comeca o segundo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(resolucoes).toHaveLength(1);

    // Resolve o SEGUNDO pedaco primeiro (fora de ordem na rede): a previa ainda nao tem o primeiro.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(resolucoes).toHaveLength(2);
    await act(async () => {
      resolucoes[1]!({ ok: true, json: async () => ({ transcricao: "segundo pedaco" }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.previa).toBe("segundo pedaco");

    // O primeiro chega depois: a previa reordena, o segundo nunca aparece antes do primeiro.
    await act(async () => {
      resolucoes[0]!({ ok: true, json: async () => ({ transcricao: "primeiro pedaco" }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.previa).toBe("primeiro pedaco segundo pedaco");

    vi.useRealTimers();
  });

  it("com reconhecimento de fala do navegador, usa a camada a e nao cria pedacos", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(gravadoresCriados).toHaveLength(1);
    const reconhecimento = ReconhecimentoFalsoDeFala.ultimo!;
    expect(reconhecimento.start).toHaveBeenCalled();
    expect(reconhecimento.continuous).toBe(true);
    expect(reconhecimento.interimResults).toBe(true);
    expect(reconhecimento.lang).toBe("pt-BR");

    act(() => {
      reconhecimento.onresult?.(eventoDeFala("falando ao vivo"));
    });

    expect(result.current.previa).toBe("falando ao vivo");
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(true);
    expect(gravadoresCriados).toHaveLength(1);
  });

  it("reconhecimento do navegador falha sem nenhum resultado antes: cai para pedacos, sem avisar erro", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    const reconhecimento = ReconhecimentoFalsoDeFala.ultimo!;

    act(() => {
      reconhecimento.onerror?.();
    });

    expect(gravadoresCriados).toHaveLength(2);
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(false);
    expect(result.current.erro).toBeNull();
  });

  it("reconhecimento do navegador para sozinho sem resultado: tambem cai para pedacos", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    const reconhecimento = ReconhecimentoFalsoDeFala.ultimo!;

    act(() => {
      reconhecimento.onend?.();
    });

    expect(gravadoresCriados).toHaveLength(2);
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(false);
  });

  it("reconhecimento sem nenhum resultado por 5s cai para pedacos mesmo sem erro nem fim", async () => {
    vi.useFakeTimers();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(gravadoresCriados).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(gravadoresCriados).toHaveLength(2);
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(false);
  });

  it("resultado chegando antes dos 5s cancela a troca para pedacos", async () => {
    vi.useFakeTimers();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    const reconhecimento = ReconhecimentoFalsoDeFala.ultimo!;

    act(() => {
      reconhecimento.onresult?.(eventoDeFala("cheguei a tempo"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(gravadoresCriados).toHaveLength(1);
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(true);
    expect(result.current.previa).toBe("cheguei a tempo");
  });

  it("nova gravacao reinicia a previa (vazia e sem marca de reconhecimento)", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("primeira fala"));
    });
    expect(result.current.previa).toBe("primeira fala");

    act(() => {
      result.current.pararGravacao();
    });
    await waitFor(() => expect(result.current.fase).toBe("inicial"));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(result.current.previa).toBe("");
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(false);
  });

  it("pararGravacao encerra a previa (nao manda mais pedacos nem fica ouvindo o reconhecimento)", async () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    const pedaco = gravadoresCriados[1]!;
    expect(pedaco.state).toBe("recording");

    act(() => {
      result.current.pararGravacao();
    });

    expect(pedaco.state).toBe("inactive");
    expect(pedaco.ondataavailable).toBeNull();
  });
});

describe("M4, item 0a: o reconhecimento que para sozinho recomeca sem perder o texto", () => {
  it("resultado, fim (sem erro), novo resultado: a previa tem os dois", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    const primeiro = ReconhecimentoFalsoDeFala.ultimo!;
    act(() => {
      primeiro.onresult?.(eventoDeFala("primeira parte"));
    });
    expect(result.current.previa).toBe("primeira parte");

    // O reconhecimento para sozinho (pausa na fala); a gravacao continua rodando.
    act(() => {
      primeiro.onend?.();
    });

    // Recomecou: uma instancia nova, sem cair para os pedacos.
    const segundo = ReconhecimentoFalsoDeFala.ultimo!;
    expect(segundo).not.toBe(primeiro);
    expect(gravadoresCriados).toHaveLength(1);
    expect(segundo.start).toHaveBeenCalled();

    act(() => {
      segundo.onresult?.(eventoDeFala("segunda parte"));
    });

    expect(result.current.previa).toBe("primeira parte segunda parte");
  });

  it("recomeca de novo depois de um segundo fim: a previa acumula as tres partes", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("um"));
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onend?.();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("dois"));
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onend?.();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("tres"));
    });

    expect(result.current.previa).toBe("um dois tres");
    // So o principal (nenhum pedaco criado: o reconhecimento recomecou as duas vezes sem cair para a camada b).
    expect(gravadoresCriados).toHaveLength(1);
  });

  it("se o recomeco falhar (.start() erra na segunda vez), cai para pedacos sem perder o texto", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    const primeiro = ReconhecimentoFalsoDeFala.ultimo!;
    act(() => {
      primeiro.onresult?.(eventoDeFala("o que ja apareceu"));
    });

    // A proxima instancia (o recomeco disparado pelo onend) falha ao chamar .start().
    ReconhecimentoFalsoDeFala.proximaFalhaNoStart = true;
    act(() => {
      primeiro.onend?.();
    });

    // Cai para os pedacos (o principal mais o primeiro pedaco), mas o texto que ja tinha aparecido fica.
    expect(gravadoresCriados).toHaveLength(2);
    expect(result.current.previa).toBe("o que ja apareceu");
    expect(result.current.previaPorReconhecimentoDoAparelho).toBe(false);
  });
});

describe("M4, item 0c: a previa vale como transcricao quando a definitiva vem vazia ou com erro", () => {
  it("audio definitivo vazio e previa com texto: usa a previa, avisa, sem erro", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("o que a pessoa falou de verdade"));
    });

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ transcricao: "" }) });
    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(onTranscrito).toHaveBeenCalledWith("o que a pessoa falou de verdade", expect.any(Number)));
    expect(result.current.avisoPreviaComoReserva).toBe(true);
    expect(result.current.erro).toBeNull();
  });

  it("a rota falha (erro) e a previa tem texto: usa a previa do mesmo jeito", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("reserva por erro de rede"));
    });

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED simulado"));
    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(onTranscrito).toHaveBeenCalledWith("reserva por erro de rede", expect.any(Number)));
    expect(result.current.avisoPreviaComoReserva).toBe(true);
    expect(result.current.erro).toBeNull();
  });

  it("audio definitivo vazio e sem previa nenhuma: continua caindo em falhaTranscricao", async () => {
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ transcricao: "" }) });
    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(result.current.erro).toBe("falhaTranscricao"));
    expect(result.current.avisoPreviaComoReserva).toBe(false);
    expect(onTranscrito).not.toHaveBeenCalled();
  });

  it("audio definitivo com texto de verdade: usa o definitivo, nunca a previa, sem aviso", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("previa qualquer"));
    });

    act(() => {
      result.current.pararGravacao();
    });

    await waitFor(() => expect(onTranscrito).toHaveBeenCalledWith("o texto que a pessoa falou", expect.any(Number)));
    expect(result.current.avisoPreviaComoReserva).toBe(false);
  });

  it("nova gravacao limpa o aviso da tentativa anterior", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ReconhecimentoFalsoDeFala;
    const onTranscrito = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onTranscrito }));

    await act(async () => {
      await result.current.iniciarGravacao();
    });
    act(() => {
      ReconhecimentoFalsoDeFala.ultimo!.onresult?.(eventoDeFala("reserva"));
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ transcricao: "" }) });
    act(() => {
      result.current.pararGravacao();
    });
    await waitFor(() => expect(result.current.avisoPreviaComoReserva).toBe(true));

    await act(async () => {
      await result.current.iniciarGravacao();
    });

    expect(result.current.avisoPreviaComoReserva).toBe(false);
  });
});
