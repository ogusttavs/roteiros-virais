import { describe, expect, it } from "vitest";

import { ehUrlDoInstagram, ErroVideo, interpretarDuracaoFfprobe, seletorDeFormato } from "./video";

describe("ehUrlDoInstagram", () => {
  it("reconhece instagram.com e www.instagram.com", () => {
    expect(ehUrlDoInstagram("https://www.instagram.com/reel/abc123/")).toBe(true);
    expect(ehUrlDoInstagram("https://instagram.com/reel/abc123/")).toBe(true);
  });

  it("nao reconhece youtube nem tiktok", () => {
    expect(ehUrlDoInstagram("https://www.youtube.com/watch?v=abc123")).toBe(false);
    expect(ehUrlDoInstagram("https://www.tiktok.com/@conta/video/123")).toBe(false);
  });

  it("url invalida devolve falso, sem lancar", () => {
    expect(ehUrlDoInstagram("nao e uma url")).toBe(false);
  });
});

describe("seletorDeFormato (transcricao do YouTube, rodada 2, item 3a)", () => {
  it("instagram: progressivo ate 480p, com fallback pro melhor progressivo (sem bv*/ba, o instagram nunca tem video-only/audio-only)", () => {
    expect(seletorDeFormato("https://www.instagram.com/reel/abc123/")).toBe("b[height<=480]/b");
  });

  it("youtube e tiktok: continuam com bv*+ba, que tem video-only e audio-only separados", () => {
    expect(seletorDeFormato("https://www.youtube.com/watch?v=abc123")).toBe("bv*[height<=480]+ba/b[height<=480]");
    expect(seletorDeFormato("https://www.tiktok.com/@conta/video/123")).toBe("bv*[height<=480]+ba/b[height<=480]");
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
