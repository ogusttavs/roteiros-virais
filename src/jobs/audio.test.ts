import { execFile } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

// Nenhum teste abre processo de verdade: `baixarAudio` so entrega os argumentos ao yt-dlp.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { config } from "@/lib/config";

import { argumentosDeAudio, baixarAudio, ErroAudio, ErroAudioTempoLimite, ocultarSegredos } from "./audio";

const PROXY = "http://usuario:senha@proxy.exemplo.invalido:823";

/**
 * Um `execFile` falso que termina na hora, com ou sem erro. O callback é sempre o ÚLTIMO argumento (com ou sem o objeto de opções
 * do meio: `baixarAudio` agora passa o tempo limite), então o falso não depende da posição.
 */
function execFileQueTermina(erro: Error | null) {
  return ((...argumentos: unknown[]) => {
    const retorno = argumentos[argumentos.length - 1] as (erro: Error | null, saida: string) => void;
    retorno(erro, "");
  }) as never;
}
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
    vi.mocked(execFile).mockImplementation(execFileQueTermina(null));

    const caminho = await baixarAudio(URL_CDN_INSTAGRAM, "instagram");

    expect(execFile).toHaveBeenCalledTimes(1);
    const [comando, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[]];
    expect(comando).toBe("yt-dlp");
    expect(args).not.toContain("--proxy");
    expect(args[args.length - 1]).toBe(URL_CDN_INSTAGRAM);
    expect(caminho.endsWith(".mp3")).toBe(true);
  });

  it("falha do yt-dlp vira ErroAudio, com a url na mensagem", async () => {
    vi.mocked(execFile).mockImplementation(execFileQueTermina(new Error("video indisponivel")));

    const chamada = () => baixarAudio(URL_CDN_INSTAGRAM, "instagram");
    await expect(chamada()).rejects.toThrow(ErroAudio);
    await expect(chamada()).rejects.toThrow(URL_CDN_INSTAGRAM);
  });

  /**
   * Achado do Fable em 28/09/2026 conferindo produção: o erro do `execFile` repete a linha de comando
   * inteira do yt-dlp, com `--proxy http://usuario:senha@host`, e isso ia parar em `execucoes_job` e no
   * admin. A mensagem do `ErroAudio` nunca pode carregar a senha.
   */
  it("falha do yt-dlp com a linha de comando inteira nunca vaza a senha do proxy na mensagem", async () => {
    config.transcricao.ytdlpProxy = PROXY;
    vi.mocked(execFile).mockImplementation(
      execFileQueTermina(new Error(`Command failed: yt-dlp -x --proxy ${PROXY} -o /tmp/a.mp3 https://www.tiktok.com/@x/video/1`)),
    );

    const chamada = () => baixarAudio("https://www.tiktok.com/@x/video/1", "tiktok");
    await expect(chamada()).rejects.toThrow(ErroAudio);
    await expect(chamada()).rejects.not.toThrow("senha");
    await expect(chamada()).rejects.toThrow("--proxy [oculto]");
  });
});

describe("ocultarSegredos", () => {
  it("tira o argumento --proxy inteiro e qualquer url com usuario e senha", () => {
    expect(ocultarSegredos(`yt-dlp --proxy ${PROXY} -o x`)).toBe("yt-dlp --proxy [oculto] -o x");
    expect(ocultarSegredos(`falhou em ${PROXY}/caminho`)).toBe("falhou em http://[oculto]@proxy.exemplo.invalido:823/caminho");
    expect(ocultarSegredos("sem segredo nenhum https://www.youtube.com/watch?v=abc")).toBe(
      "sem segredo nenhum https://www.youtube.com/watch?v=abc",
    );
  });
});

/** M5c: o tempo limite por vídeo, com um executor falso (o processo de verdade é provado em `processo.test.ts`). */
describe("baixarAudio, tempo limite por vídeo", () => {
  const MORTO_PELO_LIMITE = () => Object.assign(new Error("Command failed: yt-dlp ..."), { killed: true, signal: "SIGKILL", code: null });

  afterEach(() => {
    config.transcricao.ytdlpLimiteS = 90;
    config.transcricao.ytdlpProxy = "";
  });

  it("o limite padrão vem de YTDLP_LIMITE_S (90 s) e chega ao processo como timeout, com SIGKILL", async () => {
    let recebido: { timeout: number; killSignal: string } | null = null;
    await baixarAudio("https://www.youtube.com/watch?v=abc", "youtube", {
      executar: async (_comando, _args, opcoes) => {
        recebido = opcoes;
        return { stdout: "", stderr: "" };
      },
    });
    expect(recebido).toEqual({ timeout: 90_000, killSignal: "SIGKILL" });

    config.transcricao.ytdlpLimiteS = 45;
    await baixarAudio("https://www.youtube.com/watch?v=abc", "youtube", {
      executar: async (_comando, _args, opcoes) => {
        recebido = opcoes;
        return { stdout: "", stderr: "" };
      },
    });
    expect(recebido).toEqual({ timeout: 45_000, killSignal: "SIGKILL" });
  });

  it("o processo morto pelo limite vira ErroAudioTempoLimite (que é um ErroAudio), com a url, sem a linha de comando, e apaga o que deixou", async () => {
    config.transcricao.ytdlpProxy = PROXY;
    let pastaEPrefixo: { pasta: string; prefixo: string } | null = null;
    const { writeFile, access } = await import("node:fs/promises");
    const { dirname, basename, join } = await import("node:path");

    const chamada = baixarAudio("https://www.youtube.com/watch?v=lento", "youtube", {
      limiteMs: 5_000,
      executar: async (_comando, args) => {
        // O yt-dlp deixa o arquivo pela metade ao ser morto: o modelo de saída vem depois do "-o".
        const modelo = args[args.indexOf("-o") + 1];
        pastaEPrefixo = { pasta: dirname(modelo), prefixo: basename(modelo).split(".")[0] };
        await writeFile(join(pastaEPrefixo.pasta, `${pastaEPrefixo.prefixo}.webm.part`), "pela metade");
        throw MORTO_PELO_LIMITE();
      },
    });

    await expect(chamada).rejects.toBeInstanceOf(ErroAudioTempoLimite);
    await expect(chamada).rejects.toBeInstanceOf(ErroAudio);
    await expect(chamada).rejects.toThrow("https://www.youtube.com/watch?v=lento");
    await expect(chamada).rejects.toThrow("tempo limite");
    await expect(chamada).rejects.not.toThrow("senha");
    await expect(chamada).rejects.not.toThrow(PROXY);
    expect(pastaEPrefixo).not.toBeNull();
    await expect(access(join(pastaEPrefixo!.pasta, `${pastaEPrefixo!.prefixo}.webm.part`))).rejects.toThrow();
  });

  it("uma falha comum do yt-dlp continua sendo ErroAudio, não ErroAudioTempoLimite, e também apaga o que deixou na pasta", async () => {
    let arquivoParcial: string | null = null;
    const { writeFile, access } = await import("node:fs/promises");
    const { dirname, basename, join } = await import("node:path");

    const chamada = baixarAudio("https://www.youtube.com/watch?v=privado", "youtube", {
      executar: async (_comando, args) => {
        const modelo = args[args.indexOf("-o") + 1];
        arquivoParcial = join(dirname(modelo), `${basename(modelo).split(".")[0]}.webm.part`);
        await writeFile(arquivoParcial, "pela metade");
        throw new Error("Video unavailable");
      },
    });
    await expect(chamada).rejects.toBeInstanceOf(ErroAudio);
    await expect(chamada).rejects.not.toBeInstanceOf(ErroAudioTempoLimite);
    // A pasta é o tmpfs de 1 GB do worker: o que uma falha comum deixa lá também enche o disco (achado da revisão independente do M5c).
    expect(arquivoParcial).not.toBeNull();
    await expect(access(arquivoParcial!)).rejects.toThrow();
  });
});
