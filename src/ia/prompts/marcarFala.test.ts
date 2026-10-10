import { describe, expect, it } from "vitest";

import { textoIdentico } from "@/lib/marcas-de-fala";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { construirSaidaMock } from "../mock";

import { esforco, montarEntrada, montarSistemaEstavel, nivel, schema, versao } from "./marcarFala";

const BLOCOS = [
  { bloco: "gancho" as const, texto: "A mancha voltou depois da limpeza." },
  { bloco: "corpo" as const, texto: "Quase sempre sobra produto fundo no tecido. Passe água morna." },
  { bloco: "chamadaFinal" as const, texto: "Chame no WhatsApp." },
];

describe("o prompt da marcação de fala", () => {
  it("é uma chamada no modelo barato, com as seis marcas e a regra do texto idêntico no texto estável", () => {
    expect(nivel).toBe("barato");
    expect(esforco).toBeUndefined();
    expect(versao).toBe("1.0.0");
    const sistema = montarSistemaEstavel();
    for (const marca of ["{p:", "{d:", "{/}", "{//}", "{v}", "{^}"]) expect(sistema).toContain(marca);
    expect(sistema).toContain("IDÊNTICO");
    expect(sistema).toContain("Não troque, não tire, não acrescente");
    for (const tom of ["direto", "perto", "calmo", "firme"]) expect(sistema).toContain(`"${tom}"`);
    // A marca de "rápido" não existe (a evidência não sustenta mandar acelerar).
    expect(sistema).toContain('marca de "rápido"');
    // Estável: duas montagens iguais dão o mesmo texto (cache do prompt).
    expect(montarSistemaEstavel()).toBe(sistema);
  });

  it("a frase fixa da voz (R-FALA-24) não passa pelo modelo", () => {
    const tudo = `${montarSistemaEstavel()}\n${montarEntrada({ titulo: "t", duracaoS: 30, blocos: BLOCOS, ambienteComBarulho: true, publicoMaisVelho: true, falhouNaTentativaAnterior: ["gancho"] })}`;
    expect(tudo).not.toMatch(/fonoaudi/i);
    expect(tudo).not.toContain(textosMarcasDeFala.fraseDaVoz);
  });

  it("a entrada põe cada bloco sob o título dele e leva o contexto só quando existe", () => {
    const simples = montarEntrada({ titulo: "A mancha", duracaoS: 28, blocos: BLOCOS });
    expect(simples).toContain("cerca de 28 segundos. Título: A mancha");
    expect(simples).toContain("### gancho\nA mancha voltou depois da limpeza.");
    expect(simples).toContain("### chamadaFinal\nChame no WhatsApp.");
    expect(simples).not.toContain("barulho");
    expect(simples).not.toContain("mais velho");
    expect(simples).not.toContain("ATENÇÃO");

    const completa = montarEntrada({ titulo: "A mancha", duracaoS: 28, blocos: BLOCOS.slice(0, 1), ambienteComBarulho: true, publicoMaisVelho: true, falhouNaTentativaAnterior: ["gancho", "corpo"] });
    expect(completa).toContain("tem barulho");
    expect(completa).toContain("O público é mais velho");
    expect(completa).toContain("ATENÇÃO: na tentativa anterior o texto saiu diferente do original em: gancho (os 3 primeiros segundos), corpo.");
  });

  it("o simulador devolve os mesmos blocos, com o texto idêntico, o tom padrão e passa pelo schema", () => {
    const entrada = montarEntrada({ titulo: "A mancha", duracaoS: 28, blocos: BLOCOS });
    const saida = schema.parse(construirSaidaMock("marcarFala", entrada, ""));
    expect(saida.blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "chamadaFinal"]);
    expect(saida.blocos.map((b) => b.tom)).toEqual(["direto", "perto", "firme"]);
    for (const b of saida.blocos) expect(textoIdentico(BLOCOS.find((x) => x.bloco === b.bloco)!.texto, b.texto)).toBe(true);
    expect(saida.blocos[0].texto).toContain("{p:");
  });

  it("os marcadores do simulador estragam o texto (sempre, ou só na primeira tentativa)", () => {
    const sempre = [{ bloco: "gancho" as const, texto: "A mancha ZZESTRAGA voltou." }];
    const primeira = schema.parse(construirSaidaMock("marcarFala", montarEntrada({ titulo: "t", duracaoS: 30, blocos: sempre }), ""));
    expect(textoIdentico(sempre[0].texto, primeira.blocos[0].texto)).toBe(false);
    const segunda = schema.parse(construirSaidaMock("marcarFala", montarEntrada({ titulo: "t", duracaoS: 30, blocos: sempre, falhouNaTentativaAnterior: ["gancho"] }), ""));
    expect(textoIdentico(sempre[0].texto, segunda.blocos[0].texto)).toBe(false);

    const umaVez = [{ bloco: "gancho" as const, texto: "A mancha ZZUMAVEZ voltou." }];
    const a = schema.parse(construirSaidaMock("marcarFala", montarEntrada({ titulo: "t", duracaoS: 30, blocos: umaVez }), ""));
    const b = schema.parse(construirSaidaMock("marcarFala", montarEntrada({ titulo: "t", duracaoS: 30, blocos: umaVez, falhouNaTentativaAnterior: ["gancho"] }), ""));
    expect(textoIdentico(umaVez[0].texto, a.blocos[0].texto)).toBe(false);
    expect(textoIdentico(umaVez[0].texto, b.blocos[0].texto)).toBe(true);
  });

  it("o schema recusa um tom ou um bloco que não existe", () => {
    expect(schema.safeParse({ blocos: [{ bloco: "gancho", texto: "x", tom: "alegre" }] }).success).toBe(false);
    expect(schema.safeParse({ blocos: [{ bloco: "meio", texto: "x", tom: "direto" }] }).success).toBe(false);
    expect(schema.safeParse({ blocos: [{ bloco: "gancho", texto: "x", tom: "direto" }] }).success).toBe(true);
  });
});
