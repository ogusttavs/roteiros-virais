/**
 * Achado 3 da revisao do motor (01/10/2026): a parte de `transcreverAudio` que nao depende da
 * rede de verdade (mapear o idioma que a Groq devolve, calcular a media de `no_speech_prob`).
 * `groq-sdk` mockado por inteiro; nenhuma chamada sai da maquina.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `transcreverAudio` so usa `createReadStream` para montar o corpo da chamada (mockada abaixo);
// sem isto, o node tenta abrir o arquivo fake de verdade e estoura ENOENT fora da promise.
vi.mock("node:fs", () => ({ createReadStream: vi.fn(() => "stream-fake") }));

const create = vi.fn();
// `vi.fn().mockImplementation` com arrow function nao e construtivel ("new" falha); uma function
// comum que devolve o objeto mockado funciona (o retorno de um objeto no construtor substitui `this`).
vi.mock("groq-sdk", () => ({
  default: vi.fn().mockImplementation(function GroqMock() {
    return { audio: { transcriptions: { create } } };
  }),
}));

const { transcreverAudio } = await import("./groq-api");

describe("transcreverAudio", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("mapeia o rotulo por extenso da Groq para pt/en/es (confirmado rodando contra a API de verdade: 'English', nunca 'en')", async () => {
    create.mockResolvedValueOnce({ text: "hello there", language: "English", segments: [{ no_speech_prob: 0.1 }] });
    create.mockResolvedValueOnce({ text: "ola", language: "Portuguese", segments: [{ no_speech_prob: 0.1 }] });
    create.mockResolvedValueOnce({ text: "hola", language: "Spanish", segments: [{ no_speech_prob: 0.1 }] });

    expect((await transcreverAudio("/tmp/a.mp3")).idiomaDetectado).toBe("en");
    expect((await transcreverAudio("/tmp/a.mp3")).idiomaDetectado).toBe("pt");
    expect((await transcreverAudio("/tmp/a.mp3")).idiomaDetectado).toBe("es");
  });

  it("idioma nao reconhecido vira 'outro'; sem o campo language, null", async () => {
    create.mockResolvedValueOnce({ text: "bonjour", language: "French", segments: [{ no_speech_prob: 0.1 }] });
    create.mockResolvedValueOnce({ text: "sem idioma", segments: [{ no_speech_prob: 0.1 }] });

    expect((await transcreverAudio("/tmp/a.mp3")).idiomaDetectado).toBe("outro");
    expect((await transcreverAudio("/tmp/a.mp3")).idiomaDetectado).toBeNull();
  });

  it("media de no_speech_prob abaixo do limiar: semFala falso, texto como veio", async () => {
    create.mockResolvedValueOnce({
      text: "um video com fala de verdade",
      language: "Portuguese",
      segments: [{ no_speech_prob: 0.1 }, { no_speech_prob: 0.2 }],
    });

    const resultado = await transcreverAudio("/tmp/a.mp3");
    expect(resultado.semFala).toBe(false);
    expect(resultado.texto).toBe("um video com fala de verdade");
  });

  it("media de no_speech_prob no limiar ou acima: semFala verdadeiro, texto vazio mesmo que a Groq tenha devolvido algo", async () => {
    create.mockResolvedValueOnce({
      text: "Thank you.", // achado rodando contra a API de verdade: silencio puro vira isto, com no_speech_prob baixo por segmento as vezes, mas nao neste teste
      language: "English",
      segments: [{ no_speech_prob: 0.7 }, { no_speech_prob: 0.5 }],
    });

    const resultado = await transcreverAudio("/tmp/a.mp3");
    expect(resultado.semFala).toBe(true);
    expect(resultado.texto).toBe("");
  });

  it("sem segmento nenhum, trata como com fala (media zero)", async () => {
    create.mockResolvedValueOnce({ text: "texto sem segments", language: "Portuguese" });

    const resultado = await transcreverAudio("/tmp/a.mp3");
    expect(resultado.semFala).toBe(false);
    expect(resultado.texto).toBe("texto sem segments");
  });

  it("idiomaConhecido vira o parametro language da chamada; sem ele, a Groq decide sozinha", async () => {
    create.mockResolvedValue({ text: "x", language: "Portuguese", segments: [] });

    await transcreverAudio("/tmp/a.mp3", "en");
    expect(create.mock.calls[0][0]).toMatchObject({ language: "en" });

    create.mockClear();
    await transcreverAudio("/tmp/a.mp3");
    expect(create.mock.calls[0][0]).not.toHaveProperty("language");
  });

  it("pede sempre verbose_json, nunca o antigo 'json'", async () => {
    create.mockResolvedValue({ text: "x", language: "Portuguese", segments: [] });
    await transcreverAudio("/tmp/a.mp3");
    expect(create.mock.calls[0][0]).toMatchObject({ response_format: "verbose_json" });
  });

  it("erro da Groq vira ErroGroq, com a mensagem original dentro", async () => {
    create.mockRejectedValue(new Error("limite excedido"));
    const { ErroGroq } = await import("./groq-api");

    await expect(transcreverAudio("/tmp/a.mp3")).rejects.toThrow(ErroGroq);
    await expect(transcreverAudio("/tmp/a.mp3")).rejects.toThrow(/limite excedido/);
  });
});
