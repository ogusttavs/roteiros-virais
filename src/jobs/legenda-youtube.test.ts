import { access, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { argumentosDeLegendaJson3, baixarLegendaJson3, tamanhoMinimoDaLegenda, transcricaoDaLegenda } from "./legenda-youtube";
import { ErroLegendaDoProxy, ErroLegendaTempoLimite } from "./legendas-youtube";

const FALA = "Hoje eu vou mostrar como limpar o box do banheiro sem gastar quase nada e sem estragar o vidro, usando so o que voce ja tem em casa.";

function json3(eventos: { segs?: { utf8: string; tOffsetMs?: number; acAsrConf?: number }[] }[]): string {
  return JSON.stringify({ wireMagic: "pb3", events: eventos });
}

describe("transcricaoDaLegenda", () => {
  it("legenda manual: junta os trechos em texto puro e diz que e manual", () => {
    const entrada = json3([
      { segs: [{ utf8: "Hoje eu vou mostrar como limpar o box do banheiro" }] },
      { segs: [{ utf8: "sem gastar quase nada e sem estragar o vidro,\nusando so o que voce ja tem em casa." }] },
    ]);
    expect(transcricaoDaLegenda(entrada, 10)).toEqual({ texto: FALA, fonte: "legenda-manual" });
  });

  it("legenda automatica (palavra a palavra, com confianca): reconhece pela marca e junta as palavras", () => {
    const palavras = FALA.split(" ");
    const entrada = json3([{ segs: palavras.map((p, i) => ({ utf8: i === 0 ? p : ` ${p}`, tOffsetMs: i * 300, acAsrConf: 250 })) }]);
    const r = transcricaoDaLegenda(entrada, 10);
    expect(r?.fonte).toBe("legenda-automatica");
    expect(r?.texto).toBe(FALA);
  });

  it("tira as linhas repetidas da automatica (rolagem): igual, contida e continuacao", () => {
    const a = "Hoje eu vou mostrar como limpar o box do banheiro";
    const b = "sem gastar quase nada e sem estragar o vidro";
    const c = "usando so o que voce ja tem em casa e funciona";
    const entrada = json3([
      { segs: [{ utf8: a, acAsrConf: 200 }] },
      { segs: [{ utf8: "\n" }] },
      { segs: [{ utf8: `${a}\n${b}`, acAsrConf: 200 }] }, // a linha de cima volta com a nova
      { segs: [{ utf8: b, acAsrConf: 200 }] }, // repetida
      { segs: [{ utf8: `o vidro ${c}`, acAsrConf: 200 }] }, // comeca repetindo o fim
    ]);
    const r = transcricaoDaLegenda(entrada, 8);
    expect(r?.texto).toBe(`${a} ${b} ${c}`);
  });

  it("tira marcacao de som, notas musicais e troca de quem fala, e decodifica entidades", () => {
    const entrada = json3([
      { segs: [{ utf8: "[Musica]" }] },
      { segs: [{ utf8: "♪ ♪" }] },
      { segs: [{ utf8: "&gt;&gt; Hoje eu vou mostrar como limpar o box &amp; o vidro do banheiro" }] },
      { segs: [{ utf8: "[Aplausos] sem gastar quase nada e sem estragar nada" }] },
    ]);
    const r = transcricaoDaLegenda(entrada, 8);
    expect(r?.texto).toBe("Hoje eu vou mostrar como limpar o box & o vidro do banheiro sem gastar quase nada e sem estragar nada");
  });

  it("legenda curta demais para a duracao vira null (cai para o audio)", () => {
    const entrada = json3([{ segs: [{ utf8: "E ai pessoal, tudo bem com voces? Bora la que hoje o video e rapido e eu vou direto ao ponto, sem enrolar." }] }]);
    expect(transcricaoDaLegenda(entrada, 120)).toBeNull();
    // o mesmo texto serve para um video de poucos segundos
    expect(transcricaoDaLegenda(entrada, 8)).not.toBeNull();
  });

  it("json invalido ou sem eventos devolve null", () => {
    expect(transcricaoDaLegenda("nao e json", 30)).toBeNull();
    expect(transcricaoDaLegenda("{}", 30)).toBeNull();
    expect(transcricaoDaLegenda(json3([{}]), 30)).toBeNull();
  });
});

describe("tamanhoMinimoDaLegenda", () => {
  it("sem duracao vale o piso de 200; com duracao, 5 por segundo com minimo de 80", () => {
    expect(tamanhoMinimoDaLegenda(null)).toBe(200);
    expect(tamanhoMinimoDaLegenda(0)).toBe(200);
    expect(tamanhoMinimoDaLegenda(10)).toBe(80);
    expect(tamanhoMinimoDaLegenda(120)).toBe(600);
  });
});

describe("argumentosDeLegendaJson3", () => {
  it("pede so a legenda (manual e automatica) em json3, com o cliente do YouTube", () => {
    const args = argumentosDeLegendaJson3("https://www.youtube.com/watch?v=x", "/tmp/legenda-1.%(ext)s");
    expect(args).toEqual(expect.arrayContaining(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "pt.*,pt,en.*", "--sub-format", "json3"]));
    expect(args.join(" ")).toContain("youtube:player_client=mweb");
    expect(args.at(-1)).toBe("https://www.youtube.com/watch?v=x");
  });
});

describe("baixarLegendaJson3 (yt-dlp simulado)", () => {
  const MORTO = () => Object.assign(new Error("Command failed: yt-dlp ..."), { killed: true, signal: "SIGKILL", code: null });
  const manual = json3([{ segs: [{ utf8: FALA }] }]);
  const automatica = json3([{ segs: FALA.split(" ").map((p, i) => ({ utf8: i === 0 ? p : ` ${p}`, tOffsetMs: i * 200, acAsrConf: 250 })) }]);

  function gravar(args: string[], lang: string, conteudo: string) {
    const modelo = args[args.indexOf("-o") + 1];
    return writeFile(join(dirname(modelo), `${basename(modelo).split(".")[0]}.${lang}.json3`), conteudo);
  }

  it("idioma pt conhecido: prefere a manual a automatica", async () => {
    const r = await baixarLegendaJson3("https://www.youtube.com/watch?v=a", 10, "pt", {
      executar: async (_c, args) => {
        await gravar(args, "pt-orig", automatica);
        await gravar(args, "pt", manual);
        return { stdout: "", stderr: "" };
      },
    });
    expect(r).toEqual({ texto: FALA, fonte: "legenda-manual", idioma: "pt" });
  });

  it("video em ingles (idioma conhecido): ignora a traducao automatica para pt", async () => {
    const r = await baixarLegendaJson3("https://www.youtube.com/watch?v=b", 10, "en", {
      executar: async (_c, args) => {
        await gravar(args, "pt", automatica);
        return { stdout: "", stderr: "" };
      },
    });
    expect(r).toBeNull();
  });

  it("idioma desconhecido: so aceita a faixa original ou a manual", async () => {
    const traduzida = await baixarLegendaJson3("https://www.youtube.com/watch?v=c", 10, null, {
      executar: async (_c, args) => {
        await gravar(args, "pt", automatica);
        return { stdout: "", stderr: "" };
      },
    });
    expect(traduzida).toBeNull();
    const original = await baixarLegendaJson3("https://www.youtube.com/watch?v=c", 10, null, {
      executar: async (_c, args) => {
        await gravar(args, "pt-orig", automatica);
        return { stdout: "", stderr: "" };
      },
    });
    expect(original).toEqual({ texto: FALA, fonte: "legenda-automatica", idioma: "pt" });
  });

  it("sem arquivo de legenda ou falha comum do yt-dlp: null", async () => {
    expect(await baixarLegendaJson3("https://www.youtube.com/watch?v=d", 10, "pt", { executar: async () => ({ stdout: "", stderr: "" }) })).toBeNull();
    const falha = await baixarLegendaJson3("https://www.youtube.com/watch?v=d", 10, "pt", {
      executar: async () => {
        throw new Error("Video unavailable");
      },
    });
    expect(falha).toBeNull();
  });

  it("tempo limite vira ErroLegendaTempoLimite e apaga o que sobrou", async () => {
    let parcial: string | null = null;
    const chamada = baixarLegendaJson3("https://www.youtube.com/watch?v=e", 10, "pt", {
      limiteMs: 5_000,
      executar: async (_c, args) => {
        const modelo = args[args.indexOf("-o") + 1];
        parcial = join(dirname(modelo), `${basename(modelo).split(".")[0]}.pt.json3.part`);
        await writeFile(parcial, "pela metade");
        throw MORTO();
      },
    });
    await expect(chamada).rejects.toBeInstanceOf(ErroLegendaTempoLimite);
    await expect(access(parcial!)).rejects.toThrow();
  });

  it("proxy recusando vira ErroLegendaDoProxy", async () => {
    const chamada = baixarLegendaJson3("https://www.youtube.com/watch?v=f", 10, "pt", {
      executar: async () => {
        throw new Error("ERROR: ProxyError('Unable to connect to proxy', OSError('Tunnel connection failed: 407 TRAFFIC_EXHAUSTED'))");
      },
    });
    await expect(chamada).rejects.toBeInstanceOf(ErroLegendaDoProxy);
  });

  it("o limite padrao e o YTDLP_LIMITE_S (90 s), com SIGKILL", async () => {
    let recebido: { timeout: number; killSignal: string } | null = null;
    await baixarLegendaJson3("https://www.youtube.com/watch?v=g", 10, "pt", {
      executar: async (_c, _a, opcoes) => {
        recebido = opcoes;
        return { stdout: "", stderr: "" };
      },
    });
    expect(recebido).toEqual({ timeout: 90_000, killSignal: "SIGKILL" });
  });
});
