import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "@/lib/config";

import { argumentosYoutube, ehUrlDoYoutube, pausaEntreVideosYoutube } from "./youtube-cliente";

describe("argumentosYoutube", () => {
  it("monta o cliente mweb com o provedor de po token e sleep-requests 2, sem chamar a rede (rodada 2)", () => {
    expect(argumentosYoutube()).toEqual([
      "--extractor-args",
      "youtube:player_client=mweb",
      "--extractor-args",
      `youtubepot-bgutilhttp:base_url=${config.transcricao.potBaseUrl}`,
      "--sleep-requests",
      "2",
    ]);
  });
});

describe("pausaEntreVideosYoutube", () => {
  afterEach(() => {
    config.transcricao.youtubePausaS = 20;
  });

  it("espera config.transcricao.youtubePausaS segundos, em ms, via o esperar injetado", async () => {
    const esperar = vi.fn().mockResolvedValue(undefined);
    await pausaEntreVideosYoutube(esperar);
    expect(esperar).toHaveBeenCalledWith(20_000);
  });

  it("respeita YOUTUBE_PAUSA_S customizado", async () => {
    config.transcricao.youtubePausaS = 5;
    const esperar = vi.fn().mockResolvedValue(undefined);
    await pausaEntreVideosYoutube(esperar);
    expect(esperar).toHaveBeenCalledWith(5_000);
  });
});

describe("ehUrlDoYoutube", () => {
  it("reconhece youtube.com, www.youtube.com e youtu.be", () => {
    expect(ehUrlDoYoutube("https://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(ehUrlDoYoutube("https://youtube.com/watch?v=abc123")).toBe(true);
    expect(ehUrlDoYoutube("https://youtu.be/abc123")).toBe(true);
  });

  it("nao reconhece tiktok, instagram, nem um dominio parecido de proposito", () => {
    expect(ehUrlDoYoutube("https://www.tiktok.com/@conta/video/123")).toBe(false);
    expect(ehUrlDoYoutube("https://www.instagram.com/reel/abc/")).toBe(false);
    expect(ehUrlDoYoutube("https://naoeyoutube.com/watch?v=abc123")).toBe(false);
  });

  it("url invalida devolve falso, sem lancar", () => {
    expect(ehUrlDoYoutube("nao e uma url")).toBe(false);
  });
});
