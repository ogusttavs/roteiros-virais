import { describe, expect, it } from "vitest";

import { interpretarVtt } from "./legendas-youtube";

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
