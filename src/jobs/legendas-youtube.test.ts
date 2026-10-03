import { access, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { baixarLegendaYoutube, ErroLegendaTempoLimite, interpretarVtt } from "./legendas-youtube";

describe("interpretarVtt", () => {
  it("junta so o texto, pulando cabecalho e timestamp", () => {
    const vtt = `WEBVTT
Kind: captions
Language: pt

00:00:01.200 --> 00:00:03.360
Ola, tudo bem?

00:00:03.360 --> 00:00:05.000
Hoje eu vou falar sobre isso.`;
    expect(interpretarVtt(vtt)).toBe("Ola, tudo bem? Hoje eu vou falar sobre isso.");
  });

  it("decodifica entidades HTML (achado rodando com chave real)", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
Para o carro &gt;&gt; e ai? &amp; depois`;
    expect(interpretarVtt(vtt)).toBe("Para o carro >> e ai? & depois");
  });

  it("remove tags de estilo por palavra", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
<c>Ola</c> <c.colorFFFFFF>mundo</c>`;
    expect(interpretarVtt(vtt)).toBe("Ola mundo");
  });

  it("remove repeticao direta consecutiva (efeito rolagem)", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
mesma linha

00:00:02.000 --> 00:00:03.000
mesma linha

00:00:03.000 --> 00:00:04.000
linha diferente`;
    expect(interpretarVtt(vtt)).toBe("mesma linha linha diferente");
  });

  it("sem nenhum cue de texto, devolve string vazia", () => {
    const vtt = `WEBVTT
Kind: captions
Language: pt`;
    expect(interpretarVtt(vtt)).toBe("");
  });
});

/** M5c: o tempo limite por vídeo na legenda, com um executor falso (o processo de verdade é provado em `processo.test.ts`). */
describe("baixarLegendaYoutube, tempo limite por vídeo", () => {
  const MORTO_PELO_LIMITE = () => Object.assign(new Error("Command failed: yt-dlp ..."), { killed: true, signal: "SIGKILL", code: null });
  const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\numa legenda que o yt-dlp baixou direitinho\n";

  it("o processo morto pelo limite vira ErroLegendaTempoLimite (não 'sem legenda', que é null), e apaga o que deixou", async () => {
    let arquivoParcial: string | null = null;

    const chamada = baixarLegendaYoutube("https://www.youtube.com/watch?v=lento", "pt", {
      limiteMs: 5_000,
      executar: async (_comando, args) => {
        const modelo = args[args.indexOf("-o") + 1];
        arquivoParcial = join(dirname(modelo), `${basename(modelo).split(".")[0]}.pt.vtt.part`);
        await writeFile(arquivoParcial, "pela metade");
        throw MORTO_PELO_LIMITE();
      },
    });

    await expect(chamada).rejects.toBeInstanceOf(ErroLegendaTempoLimite);
    await expect(chamada).rejects.toThrow("tempo limite");
    expect(arquivoParcial).not.toBeNull();
    await expect(access(arquivoParcial!)).rejects.toThrow();
  });

  it("uma falha comum do yt-dlp (sem legenda, vídeo privado) continua devolvendo null, como sempre", async () => {
    const legenda = await baixarLegendaYoutube("https://www.youtube.com/watch?v=privado", "pt", {
      executar: async () => {
        throw new Error("Video unavailable");
      },
    });
    expect(legenda).toBeNull();
  });

  it("o limite chega ao processo como timeout, com SIGKILL, e o texto da legenda baixada ainda sai", async () => {
    let recebido: { timeout: number; killSignal: string } | null = null;
    const legenda = await baixarLegendaYoutube("https://www.youtube.com/watch?v=ok", "pt", {
      limiteMs: 12_345,
      executar: async (_comando, args, opcoes) => {
        recebido = opcoes;
        const modelo = args[args.indexOf("-o") + 1];
        await writeFile(join(dirname(modelo), `${basename(modelo).split(".")[0]}.pt.vtt`), VTT);
        return { stdout: "", stderr: "" };
      },
    });
    expect(recebido).toEqual({ timeout: 12_345, killSignal: "SIGKILL" });
    expect(legenda).toBe("uma legenda que o yt-dlp baixou direitinho");
  });
});
