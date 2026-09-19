import { execFile } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

// Nenhum teste abre processo de verdade: `baixarVideo480p` so entrega os argumentos ao yt-dlp.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { config } from "@/lib/config";

import { argumentosDeVideo480p, baixarVideo480p, ErroVideo, interpretarDuracaoFfprobe, seletorDeFormato } from "./video";

const PROXY = "http://usuario:senha@proxy.exemplo.invalido:823";
const URL_CDN_INSTAGRAM = "https://scontent-gru2-1.cdninstagram.com/o1/v/t16/f2/m86/AQexemplo.mp4?_nc_cat=100&oh=abc";

describe("seletorDeFormato (transcricao do YouTube, rodada 2, item 3a; ajuste 2 da revisao do PR #45)", () => {
  it("instagram: progressivo ate 480p, com fallback pro melhor progressivo (sem bv*/ba, o instagram nunca tem video-only/audio-only)", () => {
    expect(seletorDeFormato("instagram")).toBe("b[height<=480]/b");
  });

  it("youtube e tiktok: continuam com bv*+ba, que tem video-only e audio-only separados", () => {
    expect(seletorDeFormato("youtube")).toBe("bv*[height<=480]+ba/b[height<=480]");
    expect(seletorDeFormato("tiktok")).toBe("bv*[height<=480]+ba/b[height<=480]");
  });
});

/**
 * Ajuste 2 da revisao do PR #45 (V2a): `baixarVideo480p` passou a receber
 * a plataforma da linha em vez de adivinhar pelo host da url. A url direta
 * de midia da Meta (`scontent....cdninstagram.com/....mp4`) nao parece
 * Instagram pelo host: caia no seletor do YouTube/TikTok, que falha num
 * arquivo direto com "Requested format is not available", e no proxy.
 */
describe("argumentosDeVideo480p", () => {
  const URL_DIRETA_QUALQUER = "https://exemplo.invalido/videos/arquivo-direto.mp4";
  const seletorUsado = (args: string[]) => args[args.indexOf("-f") + 1];

  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
  });

  it("url de CDN do Instagram, com a plataforma instagram: seletor progressivo, e a url e a ultima coisa da chamada", () => {
    const args = argumentosDeVideo480p(URL_CDN_INSTAGRAM, "instagram", "/tmp/v.mp4");

    expect(seletorUsado(args)).toBe("b[height<=480]/b");
    expect(args[args.length - 1]).toBe(URL_CDN_INSTAGRAM);
  });

  it("uma url direta qualquer, com a plataforma instagram: tambem o seletor progressivo (o host nao decide)", () => {
    expect(seletorUsado(argumentosDeVideo480p(URL_DIRETA_QUALQUER, "instagram", "/tmp/v.mp4"))).toBe(
      "b[height<=480]/b",
    );
  });

  it("instagram nunca leva --proxy, nem com YTDLP_PROXY preenchida: o proxy se paga por gigabyte e o endereco da Meta baixa direto", () => {
    config.transcricao.ytdlpProxy = PROXY;

    expect(argumentosDeVideo480p(URL_CDN_INSTAGRAM, "instagram", "/tmp/v.mp4")).not.toContain("--proxy");
  });

  it("tiktok com YTDLP_PROXY preenchida leva --proxy e o seletor com merge de video e audio", () => {
    config.transcricao.ytdlpProxy = PROXY;
    const args = argumentosDeVideo480p("https://www.tiktok.com/@conta/video/123", "tiktok", "/tmp/v.mp4");

    expect(args).toEqual(expect.arrayContaining(["--proxy", PROXY]));
    expect(seletorUsado(args)).toBe("bv*[height<=480]+ba/b[height<=480]");
  });

  it("youtube leva o cliente mweb com o provedor de PO token, e o seletor com merge", () => {
    const args = argumentosDeVideo480p("https://www.youtube.com/watch?v=abc123", "youtube", "/tmp/v.mp4");

    expect(args).toEqual(expect.arrayContaining(["--extractor-args", "youtube:player_client=mweb"]));
    expect(seletorUsado(args)).toBe("bv*[height<=480]+ba/b[height<=480]");
  });
});

/** A ligacao que faltava: o que `baixarVideo480p` de fato entrega ao yt-dlp (ajuste 2 da revisao do PR #45). */
describe("baixarVideo480p", () => {
  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
    vi.mocked(execFile).mockReset();
  });

  function simularYtDlpQueBaixa() {
    vi.mocked(execFile).mockImplementation(((_comando: string, _args: string[], retorno: (erro: Error | null, saida: string) => void) =>
      retorno(null, "")) as never);
  }

  it("a url direta da Meta chega ao yt-dlp com o seletor progressivo e sem --proxy, mesmo com YTDLP_PROXY preenchida", async () => {
    config.transcricao.ytdlpProxy = PROXY;
    simularYtDlpQueBaixa();

    const caminho = await baixarVideo480p(URL_CDN_INSTAGRAM, "instagram");

    expect(execFile).toHaveBeenCalledTimes(1);
    const [comando, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[]];
    expect(comando).toBe("yt-dlp");
    expect(args[args.indexOf("-f") + 1]).toBe("b[height<=480]/b");
    expect(args).not.toContain("--proxy");
    expect(args[args.indexOf("-o") + 1]).toBe(caminho);
    expect(args[args.length - 1]).toBe(URL_CDN_INSTAGRAM);
  });

  it("o tiktok chega com o seletor com merge e com o proxy", async () => {
    config.transcricao.ytdlpProxy = PROXY;
    simularYtDlpQueBaixa();

    await baixarVideo480p("https://www.tiktok.com/@conta/video/123", "tiktok");

    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[]];
    expect(args[args.indexOf("-f") + 1]).toBe("bv*[height<=480]+ba/b[height<=480]");
    expect(args).toEqual(expect.arrayContaining(["--proxy", PROXY]));
  });

  it("falha do yt-dlp vira ErroVideo, com a url na mensagem", async () => {
    vi.mocked(execFile).mockImplementation(((_comando: string, _args: string[], retorno: (erro: Error | null) => void) =>
      retorno(new Error("Requested format is not available"))) as never);

    const chamada = () => baixarVideo480p(URL_CDN_INSTAGRAM, "instagram");
    await expect(chamada()).rejects.toThrow(ErroVideo);
    await expect(chamada()).rejects.toThrow(URL_CDN_INSTAGRAM);
  });
});

describe("interpretarDuracaoFfprobe (transcricao do YouTube, rodada 2, item 3b)", () => {
  it("arredonda o decimal que o ffprobe devolve (csv=p=0, so o numero)", () => {
    expect(interpretarDuracaoFfprobe("42.539000\n")).toBe(43);
    expect(interpretarDuracaoFfprobe("15.100000")).toBe(15);
  });

  it("saida vazia, nao numerica ou zero/negativa lanca ErroVideo, nunca grava duracao invalida", () => {
    expect(() => interpretarDuracaoFfprobe("")).toThrow(ErroVideo);
    expect(() => interpretarDuracaoFfprobe("N/A")).toThrow(ErroVideo);
    expect(() => interpretarDuracaoFfprobe("0")).toThrow(ErroVideo);
    expect(() => interpretarDuracaoFfprobe("-1")).toThrow(ErroVideo);
  });
});
