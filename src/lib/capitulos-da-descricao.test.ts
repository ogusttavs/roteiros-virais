import { describe, expect, it } from "vitest";

import { lerCapitulosDaDescricao, tempoDeCapitulo } from "./capitulos-da-descricao";

describe("lerCapitulosDaDescricao", () => {
  it("lê a lista de capítulos de uma descrição comum, ignorando o texto de antes e de depois", () => {
    const descricao = [
      "Neste vídeo eu mostro o passo a passo completo.",
      "",
      "Capítulos:",
      "0:00 Abertura",
      "1:15 O erro mais comum",
      "3:40 Como fazer do jeito certo",
      "7:05 Fechamento",
      "",
      "Siga no Instagram: https://exemplo.invalido/perfil",
    ].join("\n");
    expect(lerCapitulosDaDescricao(descricao, 600)).toEqual([
      { inicioS: 0, titulo: "Abertura" },
      { inicioS: 75, titulo: "O erro mais comum" },
      { inicioS: 220, titulo: "Como fazer do jeito certo" },
      { inicioS: 425, titulo: "Fechamento" },
    ]);
  });

  it("aceita marcador, colchete, traço, dois-pontos e hora", () => {
    const descricao = [
      "- 00:00 - Começo",
      "\u2022 [02:30] Segundo ponto",
      "\u25B6 5:00: Terceiro ponto",
      "(1:02:03) Quarto ponto",
    ].join("\n");
    const capitulos = lerCapitulosDaDescricao(descricao, 5000);
    expect(capitulos.map((c) => c.inicioS)).toEqual([0, 150, 300, 3723]);
    expect(capitulos.map((c) => c.titulo)).toEqual(["Começo", "Segundo ponto", "Terceiro ponto", "Quarto ponto"]);
  });

  it("aceita o traço longo e o médio como separador sem que o código carregue o caractere", () => {
    const descricao = ["0:00 \u2014 Abertura", "1:00 \u2013 Meio", "2:00 \u2014 Fim"].join("\n");
    expect(lerCapitulosDaDescricao(descricao).map((c) => c.titulo)).toEqual(["Abertura", "Meio", "Fim"]);
  });

  it("recusa a lista que não começa em 0:00", () => {
    expect(lerCapitulosDaDescricao("0:30 A\n1:00 B\n2:00 C")).toEqual([]);
  });

  it("recusa a lista com menos de três linhas", () => {
    expect(lerCapitulosDaDescricao("0:00 A\n1:00 B")).toEqual([]);
  });

  it("recusa a lista cujos tempos não crescem, e fica com a lista boa que vem depois", () => {
    expect(lerCapitulosDaDescricao("0:00 A\n2:00 B\n1:00 C")).toEqual([]);
    const depois = ["0:00 A", "2:00 B", "1:00 C", "", "0:00 Primeiro", "1:00 Segundo", "2:00 Terceiro"].join("\n");
    expect(lerCapitulosDaDescricao(depois).map((c) => c.titulo)).toEqual(["Primeiro", "Segundo", "Terceiro"]);
  });

  it("um tempo repetido não vale como capítulo seguinte", () => {
    expect(lerCapitulosDaDescricao(["0:00 A", "1:00 B", "1:00 C", "2:00 D"].join("\n"))).toEqual([]);
  });

  it("um segundo acima de 59 não é tempo, e quebra a lista", () => {
    expect(lerCapitulosDaDescricao(["0:00 A", "1:75 B", "3:00 C", "4:00 D"].join("\n"))).toEqual([]);
  });

  it("uma grade de horários sem título não é lista de capítulos", () => {
    expect(lerCapitulosDaDescricao(["0:00 - 1:00", "1:00 - 2:00", "2:00 - 3:00"].join("\n"))).toEqual([]);
  });

  it("lê a lista mesmo com emoji, marcador comum ou espaço invisível antes do tempo", () => {
    const prefixos = [
      String.fromCodePoint(0x23f0) + " ",
      String.fromCodePoint(0x1f552) + " ",
      String.fromCodePoint(0x25b6, 0xfe0f) + " ",
      String.fromCodePoint(0x2705) + " ",
      String.fromCodePoint(0x25cf) + " ",
      String.fromCodePoint(0xb7) + " ",
      String.fromCodePoint(0x200b),
    ];
    for (const prefixo of prefixos) {
      const descricao = ["0:00 Abertura", "1:00 Meio", "2:00 Fim"].map((l) => prefixo + l).join("\n");
      expect(lerCapitulosDaDescricao(descricao).map((c) => c.titulo), `prefixo U+${prefixo.codePointAt(0)?.toString(16)}`).toEqual(["Abertura", "Meio", "Fim"]);
    }
  });

  it("lista de intervalo: o título não carrega o segundo tempo", () => {
    const capitulos = lerCapitulosDaDescricao(["0:00-0:30 Abertura", "0:30 - 1:15 Meio", "1:15-2:00 Fim"].join("\n"));
    expect(capitulos.map((c) => [c.inicioS, c.titulo])).toEqual([
      [0, "Abertura"],
      [30, "Meio"],
      [75, "Fim"],
    ]);
  });

  it("corta o título sem partir um caractere em dois", () => {
    const [primeiro] = lerCapitulosDaDescricao(["0:00 " + "x".repeat(99) + String.fromCodePoint(0x1f600) + "y", "1:00 B", "2:00 C"].join("\n"));
    expect(Array.from(primeiro.titulo)).toHaveLength(100);
    expect(primeiro.titulo.endsWith(String.fromCodePoint(0x1f600))).toBe(true);
  });

  it("recusa a lista que passa do fim do vídeo", () => {
    const descricao = "0:00 A\n5:00 B\n15:00 C";
    expect(lerCapitulosDaDescricao(descricao, 600)).toEqual([]);
    expect(lerCapitulosDaDescricao(descricao, 1200)).toHaveLength(3);
    // sem a duração conhecida, a lista vale
    expect(lerCapitulosDaDescricao(descricao, null)).toHaveLength(3);
  });

  it("não confunde horário solto, link ou hora marcada com capítulo: só a lista de verdade sai", () => {
    const descricao = [
      "Ao vivo às 10:30 e depois às 21:00",
      "https://exemplo.invalido:8080/ao-vivo",
      "10:30 - 11:00",
      "",
      "0:00 Abertura",
      "1:00 Meio",
      "2:00 Fim",
    ].join("\n");
    expect(lerCapitulosDaDescricao(descricao).map((c) => c.titulo)).toEqual(["Abertura", "Meio", "Fim"]);
  });

  it("uma linha em branco no meio fecha a lista", () => {
    expect(lerCapitulosDaDescricao("0:00 A\n1:00 B\n\n2:00 C\n3:00 D")).toEqual([]);
  });

  it("limita o título e junta os espaços", () => {
    const longo = "x".repeat(200);
    const [primeiro, segundo] = lerCapitulosDaDescricao(`0:00 ${longo}\n1:00   dois    espaços\n2:00 Fim`);
    expect(primeiro.titulo).toHaveLength(100);
    expect(segundo.titulo).toBe("dois espaços");
  });

  it("descrição vazia, nula ou sem lista devolve vazio", () => {
    expect(lerCapitulosDaDescricao(null)).toEqual([]);
    expect(lerCapitulosDaDescricao("")).toEqual([]);
    expect(lerCapitulosDaDescricao("Só texto, sem tempo nenhum.")).toEqual([]);
  });
});

describe("tempoDeCapitulo", () => {
  it("escreve minuto e segundo, e a hora só a partir de uma hora", () => {
    expect(tempoDeCapitulo(0)).toBe("0:00");
    expect(tempoDeCapitulo(75)).toBe("1:15");
    expect(tempoDeCapitulo(599)).toBe("9:59");
    expect(tempoDeCapitulo(3723)).toBe("1:02:03");
  });
});
