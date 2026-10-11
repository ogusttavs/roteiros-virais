import { describe, expect, it } from "vitest";

import { construirSaidaMock } from "../mock";

import { montarEntrada, montarSistemaEstavel, nivel, schema, versao } from "./extrairVideoLongo";

const BASE = {
  titulo: "Como tirar mancha do sofá sem estragar o tecido",
  handle: "casaemordem",
  descricao: "Passo a passo completo.",
  duracaoS: 612,
  capitulosDaDescricao: [] as { inicioS: number; titulo: string }[],
  transcricaoComTempos: "[0:00] oi gente hoje eu vou mostrar\n[1:00] o primeiro erro é esfregar",
  nomeNicho: "Limpeza",
  termosNicho: ["limpeza", "sofá"],
};

describe("extrairVideoLongo", () => {
  it("usa o modelo barato e a versão começa em 1.0.0", () => {
    expect(nivel).toBe("barato");
    expect(versao).toBe("1.0.0");
  });

  it("o sistema diz que as marcas de tempo são aproximadas, que a lista do dono está certa e que a retenção não é dado da plataforma", () => {
    const sistema = montarSistemaEstavel();
    expect(sistema).toContain("APROXIMADAS");
    expect(sistema).toContain("a lista de capítulos que");
    expect(sistema).toContain("não um dado da");
    // regras 1 e 2 do projeto: sem travessão e sem emoji no que o modelo lê
    expect(sistema).not.toMatch(new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]"));
    expect(sistema).not.toMatch(new RegExp(String.fromCharCode(92) + "p{Extended_Pictographic}", "u"));
  });

  it("a entrada traz a duração, o começo da descrição, a transcrição com as marcas e o lembrete de acentuação", () => {
    const entrada = montarEntrada(BASE);
    expect(entrada).toContain("Duracao: 612 segundos (10:12)");
    expect(entrada).toContain("Conta: @casaemordem");
    expect(entrada).toContain("Descricao (o começo): Passo a passo completo.");
    expect(entrada).toContain("[1:00] o primeiro erro");
    expect(entrada).toContain("acentuação correta");
    expect(entrada).toContain("nenhum (proponha os capítulos pelo texto)");
  });

  it("com a lista do dono, os capítulos entram com os tempos exatos", () => {
    const entrada = montarEntrada({
      ...BASE,
      capitulosDaDescricao: [
        { inicioS: 0, titulo: "Abertura" },
        { inicioS: 75, titulo: "O erro mais comum" },
        { inicioS: 3723, titulo: "Fim" },
      ],
    });
    expect(entrada).toContain("Capítulos que o dono escreveu na descrição (tempos exatos):\n0:00 Abertura\n1:15 O erro mais comum\n62:03 Fim");
    expect(entrada).not.toContain("nenhum (proponha");
  });

  it("a descrição entra cortada no começo, e sem descrição nem conta a entrada diz isso", () => {
    const longa = "x".repeat(5000);
    const entrada = montarEntrada({ ...BASE, descricao: longa, handle: null });
    expect(entrada).toContain("Conta: (sem conta)");
    const linha = entrada.split("\n").find((l) => l.startsWith("Descricao"))!;
    expect(linha.length).toBeLessThan(1300);
    expect(montarEntrada({ ...BASE, descricao: null })).toContain("(sem descrição)");
  });

  it("o simulador devolve uma saída que passa no schema, com os capítulos da descrição quando ela traz", () => {
    const entrada = montarEntrada({
      ...BASE,
      capitulosDaDescricao: [
        { inicioS: 0, titulo: "Abertura" },
        { inicioS: 120, titulo: "O problema" },
        { inicioS: 300, titulo: "A solução" },
      ],
    });
    const saida = schema.parse(construirSaidaMock("extrairVideoLongo", entrada));
    expect(saida.capitulos.map((c) => [c.inicioS, c.nome])).toEqual([
      [0, "Abertura"],
      [120, "O problema"],
      [300, "A solução"],
    ]);
    // sem a lista, quatro capítulos nos quartos da duração
    const sem = schema.parse(construirSaidaMock("extrairVideoLongo", montarEntrada(BASE)));
    expect(sem.capitulos).toHaveLength(4);
    expect(sem.capitulos[1].inicioS).toBe(153);
  });

  it("um tipo de abertura fora da lista vira 'outro' em vez de perder a leitura inteira", () => {
    const base = construirSaidaMock("extrairVideoLongo", montarEntrada(BASE)) as Record<string, unknown>;
    const lida = schema.parse({ ...base, abertura: { promessa: "x", entregaAteS: null, tipo: "inventado" } });
    expect(lida.abertura.tipo).toBe("outro");
  });
});
