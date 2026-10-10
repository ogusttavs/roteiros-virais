/**
 * As regras puras do cartão "Em alta hoje" (E55 PR 2): o número de buscas do Google, "desde quando" o assunto está em alta (a primeira rodada das que vêm seguidas até a de agora) e o dia e a
 * hora dessa rodada, no fuso do Brasil.
 */
import { describe, expect, it } from "vitest";

import { desdeQuandoDe, formatarBuscasDoGoogle, rodadaMaisAntigaSeguida } from "./em-alta";

describe("formatarBuscasDoGoogle", () => {
  it("escreve o número com ponto de milhar e sem o mais: '2000+' vira '2.000'", () => {
    expect(formatarBuscasDoGoogle("2000+")).toBe("2.000");
    expect(formatarBuscasDoGoogle("200+")).toBe("200");
    expect(formatarBuscasDoGoogle(" 20000+ ")).toBe("20.000");
  });

  it("entende o K e o M do Google ('500K+' vira '500.000')", () => {
    expect(formatarBuscasDoGoogle("500K+")).toBe("500.000");
    expect(formatarBuscasDoGoogle("1M+")).toBe("1.000.000");
  });

  it("com K ou M, o ponto ou a vírgula é decimal, e sem eles é milhar ('1,5M+' são 1.500.000; '12.345+' são 12.345)", () => {
    expect(formatarBuscasDoGoogle("1,5M+")).toBe("1.500.000");
    expect(formatarBuscasDoGoogle("1.5K+")).toBe("1.500");
    expect(formatarBuscasDoGoogle("2,25K+")).toBe("2.250");
    expect(formatarBuscasDoGoogle("12.345+")).toBe("12.345");
    expect(formatarBuscasDoGoogle("500 mil")).toBeNull();
  });

  it("sem número (nulo, vazio, texto, zero) não inventa nada", () => {
    expect(formatarBuscasDoGoogle(null)).toBeNull();
    expect(formatarBuscasDoGoogle("")).toBeNull();
    expect(formatarBuscasDoGoogle("muitas")).toBeNull();
    expect(formatarBuscasDoGoogle("0+")).toBeNull();
  });
});

describe("rodadaMaisAntigaSeguida", () => {
  const assunto = { chave: "frente fria", termos: ["frente fria", "frio"] };
  const rodada = (iso: string, assuntos: { chave: string; termos: string[] }[]) => ({ coletadaEm: new Date(iso), assuntos });
  const comOAssunto = [assunto, { chave: "copa do brasil", termos: ["copa do brasil"] }];
  const semOAssunto = [{ chave: "novela das nove", termos: ["novela"] }];

  it("é a mais antiga das rodadas que vêm seguidas até a de agora, todas com o assunto", () => {
    const rodadas = [
      rodada("2026-10-09T08:50:00Z", comOAssunto),
      rodada("2026-10-09T15:00:00Z", comOAssunto),
      rodada("2026-10-08T15:00:00Z", comOAssunto),
      rodada("2026-10-08T08:50:00Z", semOAssunto),
      rodada("2026-10-07T15:00:00Z", comOAssunto),
    ];
    // Ordem de entrada embaralhada de propósito: a conta é por data, não pela ordem em que as rodadas chegam. O assunto que saiu e voltou conta a partir da volta.
    expect(rodadaMaisAntigaSeguida(assunto, rodadas)).toEqual(new Date("2026-10-08T15:00:00Z"));
  });

  it("casa pelo termo, não só pela chave: o assunto volta com outro nome na lista, mas dividindo a palavra de busca", () => {
    const rodadas = [rodada("2026-10-09T08:50:00Z", [{ chave: "o frio chegou", termos: ["frente fria"] }]), rodada("2026-10-09T15:00:00Z", comOAssunto)];
    expect(rodadaMaisAntigaSeguida(assunto, rodadas)).toEqual(new Date("2026-10-09T08:50:00Z"));
  });

  it("se a rodada de agora não tem o assunto, não há desde (nulo)", () => {
    expect(rodadaMaisAntigaSeguida(assunto, [rodada("2026-10-09T15:00:00Z", semOAssunto), rodada("2026-10-09T08:50:00Z", comOAssunto)])).toBeNull();
    expect(rodadaMaisAntigaSeguida(assunto, [])).toBeNull();
  });

  it("uma rodada só com o assunto é o próprio desde", () => {
    expect(rodadaMaisAntigaSeguida(assunto, [rodada("2026-10-09T15:00:00Z", comOAssunto)])).toEqual(new Date("2026-10-09T15:00:00Z"));
  });
});

describe("desdeQuandoDe", () => {
  // 08:50 UTC é 05:50 em Brasília; 15:00 UTC é 12:00.
  it("diz o dia (hoje, ontem, antes) e a hora cheia, no fuso do Brasil", () => {
    expect(desdeQuandoDe(new Date("2026-10-09T08:50:00Z"), "2026-10-09")).toEqual({ dia: "hoje", hora: 5 });
    expect(desdeQuandoDe(new Date("2026-10-08T15:00:00Z"), "2026-10-09")).toEqual({ dia: "ontem", hora: 12 });
    expect(desdeQuandoDe(new Date("2026-10-07T15:00:00Z"), "2026-10-09")).toEqual({ dia: "antes", hora: 12 });
  });

  it("a virada do dia é a do Brasil, não a do servidor: 02:30 UTC de 09/10 ainda é a noite de 08/10 em Brasília (23h30)", () => {
    expect(desdeQuandoDe(new Date("2026-10-09T02:30:00Z"), "2026-10-09")).toEqual({ dia: "ontem", hora: 23 });
  });

  it("a meia-noite do Brasil é a hora 0, nunca 24", () => {
    expect(desdeQuandoDe(new Date("2026-10-09T03:10:00Z"), "2026-10-09")).toEqual({ dia: "hoje", hora: 0 });
  });
});
