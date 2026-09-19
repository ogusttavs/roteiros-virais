import { execFile } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

// Nenhum teste abre processo de verdade: `baixarAudio` so entrega os argumentos ao yt-dlp.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { config } from "@/lib/config";

import { argumentosDeAudio, baixarAudio, ErroAudio } from "./audio";

const PROXY = "http://usuario:senha@proxy.exemplo.invalido:823";
const URL_CDN_INSTAGRAM = "https://scontent-gru2-1.cdninstagram.com/o1/v/t16/f2/m86/AQexemplo.mp4?_nc_cat=100&oh=abc";

/**
 * Ajuste 2 da revisao do PR #45 (V2a): `baixarAudio` passou a receber a
 * plataforma da linha. `transcrever` e `meta-hashtags` passam a url direta
 * de midia da Meta, que nao parece Instagram pelo host; com o palpite antigo
 * por host esse download ia pelo proxy, que se paga por gigabyte.
 */
describe("argumentosDeAudio", () => {
  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
  });

  it("url de CDN do Instagram nunca leva --proxy, nem com YTDLP_PROXY preenchida", () => {
    config.transcricao.ytdlpProxy = PROXY;
    const args = argumentosDeAudio(URL_CDN_INSTAGRAM, "instagram", "/tmp/audio.%(ext)s");

    expect(args).not.toContain("--proxy");
    expect(args).toEqual(expect.arrayContaining(["-x", "--audio-format", "mp3"]));
    expect(args[args.length - 1]).toBe(URL_CDN_INSTAGRAM);
  });

  it("tiktok com YTDLP_PROXY preenchida leva --proxy", () => {
    config.transcricao.ytdlpProxy = PROXY;

    expect(argumentosDeAudio("https://www.tiktok.com/@conta/video/123", "tiktok", "/tmp/audio.%(ext)s")).toEqual(
      expect.arrayContaining(["--proxy", PROXY]),
    );
  });

  it("youtube leva o cliente mweb com o provedor de PO token", () => {
    expect(argumentosDeAudio("https://www.youtube.com/watch?v=abc123", "youtube", "/tmp/audio.%(ext)s")).toEqual(
      expect.arrayContaining(["--extractor-args", "youtube:player_client=mweb"]),
    );
  });
});

/** A ligacao que faltava: o que `baixarAudio` de fato entrega ao yt-dlp (ajuste 2 da revisao do PR #45). */
describe("baixarAudio", () => {
  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
    vi.mocked(execFile).mockReset();
  });

  it("a url direta da Meta chega ao yt-dlp sem --proxy, mesmo com YTDLP_PROXY preenchida, e devolve o mp3", async () => {
    config.transcricao.ytdlpProxy = PROXY;
    vi.mocked(execFile).mockImplementation(((_comando: string, _args: string[], retorno: (erro: Error | null, saida: string) => void) =>
      retorno(null, "")) as never);

    const caminho = await baixarAudio(URL_CDN_INSTAGRAM, "instagram");

    expect(execFile).toHaveBeenCalledTimes(1);
    const [comando, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[]];
    expect(comando).toBe("yt-dlp");
    expect(args).not.toContain("--proxy");
    expect(args[args.length - 1]).toBe(URL_CDN_INSTAGRAM);
    expect(caminho.endsWith(".mp3")).toBe(true);
  });

  it("falha do yt-dlp vira ErroAudio, com a url na mensagem", async () => {
    vi.mocked(execFile).mockImplementation(((_comando: string, _args: string[], retorno: (erro: Error | null) => void) =>
      retorno(new Error("video indisponivel"))) as never);

    const chamada = () => baixarAudio(URL_CDN_INSTAGRAM, "instagram");
    await expect(chamada()).rejects.toThrow(ErroAudio);
    await expect(chamada()).rejects.toThrow(URL_CDN_INSTAGRAM);
  });
});
