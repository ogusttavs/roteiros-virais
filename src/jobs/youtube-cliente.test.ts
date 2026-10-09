import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "@/lib/config";

import {
  argumentosPorPlataforma,
  argumentosProxy,
  argumentosYoutube,
  ehUrlDoYoutube,
  ErroDoProxy,
  motivoDaFalhaDoProxy,
  pausaEntreVideosYoutube,
} from "./youtube-cliente";

describe("argumentosYoutube", () => {
  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
  });

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

  /** Preparacao da viagem, item 0: com YTDLP_PROXY preenchida, acrescenta --proxy no fim. */
  it("com YTDLP_PROXY preenchida, acrescenta --proxy <url> no fim", () => {
    config.transcricao.ytdlpProxy = "http://usuario:senha@proxy.dataimpulse.com:823";
    expect(argumentosYoutube()).toEqual([
      "--extractor-args",
      "youtube:player_client=mweb",
      "--extractor-args",
      `youtubepot-bgutilhttp:base_url=${config.transcricao.potBaseUrl}`,
      "--sleep-requests",
      "2",
      "--proxy",
      "http://usuario:senha@proxy.dataimpulse.com:823",
    ]);
  });
});

describe("argumentosProxy", () => {
  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
  });

  it("vazia por padrao, sem YTDLP_PROXY", () => {
    expect(argumentosProxy()).toEqual([]);
  });

  it("com YTDLP_PROXY preenchida, devolve --proxy <url>", () => {
    config.transcricao.ytdlpProxy = "http://usuario:senha@proxy.dataimpulse.com:823";
    expect(argumentosProxy()).toEqual(["--proxy", "http://usuario:senha@proxy.dataimpulse.com:823"]);
  });
});

/** Ajuste 2 da revisao do PR #45 (V2a): a plataforma da linha decide, nunca o host da url. */
describe("argumentosPorPlataforma", () => {
  afterEach(() => {
    config.transcricao.ytdlpProxy = "";
  });

  it("instagram: nunca nada, mesmo com YTDLP_PROXY preenchida (proxy se paga por gigabyte)", () => {
    config.transcricao.ytdlpProxy = "http://usuario:senha@proxy.dataimpulse.com:823";
    expect(argumentosPorPlataforma("instagram")).toEqual([]);
  });

  it("tiktok: so o proxy, quando preenchido", () => {
    expect(argumentosPorPlataforma("tiktok")).toEqual([]);
    config.transcricao.ytdlpProxy = "http://usuario:senha@proxy.dataimpulse.com:823";
    expect(argumentosPorPlataforma("tiktok")).toEqual(["--proxy", "http://usuario:senha@proxy.dataimpulse.com:823"]);
  });

  it("youtube: o cliente mweb com o provedor de po token (o proxy vai junto, dentro de argumentosYoutube)", () => {
    config.transcricao.ytdlpProxy = "http://usuario:senha@proxy.dataimpulse.com:823";
    expect(argumentosPorPlataforma("youtube")).toEqual(argumentosYoutube());
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

/**
 * Hotfix do proxy (09/10/2026): o proxy do YouTube, cobrado por gigabyte, acabou, e o job tentava 109 videos por noite contra um 407. So as frases do proprio erro do proxy contam: a linha de
 * comando que o erro repete leva "--proxy http://...", e uma busca larga pela palavra casaria com toda falha.
 */
describe("motivoDaFalhaDoProxy", () => {
  it("o 407 TRAFFIC_EXHAUSTED do pacote que acabou e \"proxy sem trafego\", com o texto completo que o yt-dlp devolve", () => {
    expect(motivoDaFalhaDoProxy("ERROR: Unable to download webpage: ProxyError('Unable to connect to proxy', OSError('Tunnel connection failed: 407 TRAFFIC_EXHAUSTED'))")).toBe("proxy sem trafego");
    expect(motivoDaFalhaDoProxy("HTTP Error 407: Proxy Authentication Required")).toBe("proxy sem trafego");
    expect(motivoDaFalhaDoProxy("traffic_exhausted")).toBe("proxy sem trafego");
  });

  it("o proxy que nao conecta, sem o 407, e \"proxy fora do ar\"", () => {
    expect(motivoDaFalhaDoProxy("ERROR: ProxyError('Unable to connect to proxy', ConnectionRefusedError(10061))")).toBe("proxy fora do ar");
  });

  it("o erro do video (privado, removido, bloqueio do robo) nao e do proxy, mesmo com --proxy na linha de comando", () => {
    expect(motivoDaFalhaDoProxy("Command failed: yt-dlp --proxy http://[oculto]@proxy.exemplo.invalido:823 -x https://www.youtube.com/watch?v=abc\nERROR: Video unavailable")).toBeNull();
    expect(motivoDaFalhaDoProxy("ERROR: Sign in to confirm you're not a bot")).toBeNull();
    expect(motivoDaFalhaDoProxy("")).toBeNull();
  });

  it("o numero 407 solto no id de um video nao e erro de proxy", () => {
    expect(motivoDaFalhaDoProxy("ERROR: [youtube] 407abcdefgh: Video unavailable")).toBeNull();
  });
});

describe("ErroDoProxy", () => {
  it("carrega o motivo, e e um Error com nome", () => {
    const erro = new ErroDoProxy("proxy sem trafego", "o proxy recusou");
    expect(erro).toBeInstanceOf(Error);
    expect(erro.motivo).toBe("proxy sem trafego");
    expect(erro.name).toBe("ErroDoProxy");
  });
});
