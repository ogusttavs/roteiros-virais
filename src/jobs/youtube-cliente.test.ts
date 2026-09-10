import { describe, expect, it } from "vitest";

import { argumentosYoutube, ehUrlDoYoutube } from "./youtube-cliente";

describe("argumentosYoutube", () => {
  it("monta o cliente sem po token e um sleep pequeno, sem chamar a rede", () => {
    expect(argumentosYoutube()).toEqual([
      "--extractor-args",
      "youtube:player_client=web_embedded",
      "--sleep-requests",
      "1",
    ]);
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
