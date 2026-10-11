import { describe, expect, it } from "vitest";

import type { SaidaExtrairVideoLongo } from "@/ia/prompts/extrairVideoLongo";

import { conferirLeituraDoLongo, MAX_CARACTERES_DO_TEXTO, transcricaoComTempos } from "./leitura-dos-longos";

describe("transcricaoComTempos", () => {
  it("põe uma marca no começo e outra a cada minuto, pela posição da palavra no texto", () => {
    // 120 palavras em 120 segundos: uma palavra por segundo
    const texto = Array.from({ length: 120 }, (_, i) => `p${i}`).join(" ");
    const marcado = transcricaoComTempos(texto, 120);
    const linhas = marcado.split("\n").filter((l) => l !== "");
    expect(linhas).toHaveLength(2);
    expect(linhas[0].startsWith("[0:00] p0 p1")).toBe(true);
    expect(linhas[1].startsWith("[1:00] p60 p61")).toBe(true);
    // nenhuma palavra se perde
    expect(marcado.replace(/\[[0-9:]+\] /g, "").split(/\s+/).filter(Boolean)).toHaveLength(120);
  });

  it("o tempo de uma palavra é a posição dela em proporção da duração, não uma palavra por segundo", () => {
    // 300 palavras em 600 segundos: a palavra 150 está em 300 s (5:00)
    const texto = Array.from({ length: 300 }, (_, i) => `p${i}`).join(" ");
    const marcado = transcricaoComTempos(texto, 600, 60);
    expect(marcado).toContain("[5:00] p150");
    expect(marcado).toContain("[9:00] p270");
  });

  it("salta as marcas que o texto não alcançou (um silêncio no meio), sem repetir a marca", () => {
    const texto = "um dois tres quatro";
    const marcado = transcricaoComTempos(texto, 1200, 60);
    const marcas = marcado.match(/\[[0-9:]+\]/g) ?? [];
    expect(new Set(marcas).size).toBe(marcas.length);
    expect(marcas[0]).toBe("[0:00]");
  });

  it("corta o texto no tamanho máximo DEPOIS de contar os tempos, e diz que continua", () => {
    const texto = Array.from({ length: 4000 }, (_, i) => `palavra${i}`).join(" ");
    const marcado = transcricaoComTempos(texto, 2400, 60, 5_000);
    expect(marcado.length).toBeLessThan(5_200);
    expect(marcado.endsWith("[o texto continua além deste ponto]")).toBe(true);
    // a última marca antes do corte já é bem depois do começo: os tempos foram contados sobre o texto inteiro
    const marcas = marcado.match(/\[(\d+):(\d{2})\]/g) ?? [];
    expect(marcas.length).toBeGreaterThan(3);
    expect(MAX_CARACTERES_DO_TEXTO).toBe(60_000);
  });

  it("texto vazio ou duração zero devolve o texto sem marca nenhuma", () => {
    expect(transcricaoComTempos("", 600)).toBe("");
    expect(transcricaoComTempos("so um texto", 0)).toBe("so um texto");
  });
});

const SAIDA: SaidaExtrairVideoLongo = {
  assunto: "  limpeza de sofá  ",
  abertura: { promessa: "tirar mancha sem estragar", entregaAteS: 40, tipo: "resultado" },
  capitulos: [
    { inicioS: 0, nome: "Abertura", oQueFaz: "mostra o resultado", gancho: "e o erro mais comum vem já" },
    { inicioS: 90, nome: "O erro", oQueFaz: "mostra o que não fazer", gancho: "agora o jeito certo" },
    { inicioS: 240, nome: "O jeito certo", oQueFaz: "passo a passo", gancho: "falta uma coisa" },
    { inicioS: 480, nome: "Fechamento", oQueFaz: "resume", gancho: "esse gancho tem de sumir" },
  ],
  lacos: [{ abertoEmS: 60, pagoEmS: 400, oQue: "o erro que mais custa" }],
  ondeSairia: [{ segundo: 300, porQue: "repete o que já disse" }],
  fechamento: { oQueFaz: "chama para o próximo", apontaParaProximoVideo: true },
  porQueFuncionou: "cada capítulo deixa uma pergunta aberta",
};

const CONTEXTO = { duracaoS: 600, capitulosDaDescricao: [], versaoPrompt: "1.0.0" };

describe("conferirLeituraDoLongo", () => {
  it("sem lista do dono, vale a do modelo: tempos dentro do vídeo, em ordem, o primeiro em zero e o último sem gancho", () => {
    const analise = conferirLeituraDoLongo(
      {
        ...SAIDA,
        capitulos: [
          { inicioS: 200.4, nome: "Meio", oQueFaz: "x", gancho: "y" },
          { inicioS: 12, nome: "Abertura", oQueFaz: "x", gancho: "y" },
          { inicioS: 580, nome: "Fim", oQueFaz: "x", gancho: "gancho que tem de sumir" },
        ],
      },
      CONTEXTO,
    )!;
    expect(analise.origemDosCapitulos).toBe("leitura");
    // o primeiro vira zero e o do meio é arredondado
    expect(analise.capitulos.map((c) => [c.inicioS, c.nome])).toEqual([
      [0, "Abertura"],
      [200, "Meio"],
      [580, "Fim"],
    ]);
    expect(analise.capitulos[analise.capitulos.length - 1].gancho).toBeNull();
    expect(analise.capitulos[0].gancho).toBe("y");
    expect(analise.versaoPrompt).toBe("1.0.0");
    expect(analise.assunto).toBe("limpeza de sofá");
  });

  it("com a lista do dono, os tempos e os nomes são dele, e do modelo vêm o que o capítulo faz e o gancho do capítulo mais perto", () => {
    const analise = conferirLeituraDoLongo(SAIDA, {
      ...CONTEXTO,
      capitulosDaDescricao: [
        { inicioS: 0, titulo: "Começo" },
        { inicioS: 100, titulo: "O erro de todo mundo" },
        { inicioS: 250, titulo: "Como fazer" },
        { inicioS: 470, titulo: "Fim" },
      ],
    })!;
    expect(analise.origemDosCapitulos).toBe("descricao");
    expect(analise.capitulos.map((c) => [c.inicioS, c.nome, c.oQueFaz])).toEqual([
      [0, "Começo", "mostra o resultado"],
      [100, "O erro de todo mundo", "mostra o que não fazer"],
      [250, "Como fazer", "passo a passo"],
      [470, "Fim", "resume"],
    ]);
    expect(analise.capitulos[1].gancho).toBe("agora o jeito certo");
    // o último nunca segura ninguém: não há próximo
    expect(analise.capitulos[3].gancho).toBeNull();
  });

  it("menos de três capítulos (o modelo não achou estrutura) é recusado", () => {
    expect(conferirLeituraDoLongo({ ...SAIDA, capitulos: SAIDA.capitulos.slice(0, 2) }, CONTEXTO)).toBeNull();
    // início repetido e nome vazio não contam
    expect(
      conferirLeituraDoLongo(
        {
          ...SAIDA,
          capitulos: [
            { inicioS: 0, nome: "A", oQueFaz: "x", gancho: null },
            { inicioS: 0, nome: "B", oQueFaz: "x", gancho: null },
            { inicioS: 100, nome: "  ", oQueFaz: "x", gancho: null },
          ],
        },
        CONTEXTO,
      ),
    ).toBeNull();
  });

  it("o capítulo do modelo que começa no fim do vídeo ou depois dele não é capítulo (grampeado, viraria um de duração zero)", () => {
    const analise = conferirLeituraDoLongo(
      {
        ...SAIDA,
        capitulos: [
          { inicioS: 0, nome: "A", oQueFaz: "x", gancho: null },
          { inicioS: 100, nome: "B", oQueFaz: "x", gancho: null },
          { inicioS: 300, nome: "C", oQueFaz: "x", gancho: null },
          { inicioS: 600, nome: "No fim", oQueFaz: "x", gancho: null },
          { inicioS: 900, nome: "Depois", oQueFaz: "x", gancho: null },
        ],
      },
      CONTEXTO,
    )!;
    expect(analise.capitulos.map((c) => c.nome)).toEqual(["A", "B", "C"]);
  });

  it("a lista do dono sem estrutura do modelo (capítulos vazios) é recusada: senão gravaria tudo vazio e o vídeo nunca mais seria lido", () => {
    const doDono = [
      { inicioS: 0, titulo: "Um" },
      { inicioS: 100, titulo: "Dois" },
      { inicioS: 200, titulo: "Três" },
    ];
    expect(conferirLeituraDoLongo({ ...SAIDA, capitulos: [] }, { ...CONTEXTO, capitulosDaDescricao: doDono })).toBeNull();
    expect(conferirLeituraDoLongo({ ...SAIDA, capitulos: SAIDA.capitulos.slice(0, 2) }, { ...CONTEXTO, capitulosDaDescricao: doDono })).toBeNull();
  });

  it("a lista do dono não é cortada em doze: vinte capítulos dele são vinte, e só o último fica sem gancho", () => {
    const doDono = Array.from({ length: 20 }, (_, i) => ({ inicioS: i * 30, titulo: `Cap ${i + 1}` }));
    const analise = conferirLeituraDoLongo(SAIDA, { ...CONTEXTO, capitulosDaDescricao: doDono })!;
    expect(analise.origemDosCapitulos).toBe("descricao");
    expect(analise.capitulos).toHaveLength(20);
    expect(analise.capitulos[19]).toMatchObject({ inicioS: 570, nome: "Cap 20", gancho: null });
  });

  it("o capítulo do dono que o modelo não cobriu fica sem 'o que faz', e não herda o texto de um vizinho", () => {
    const doDono = [0, 100, 200, 300, 400, 500].map((inicioS, i) => ({ inicioS, titulo: `Cap ${i + 1}` }));
    const analise = conferirLeituraDoLongo(
      {
        ...SAIDA,
        capitulos: [
          { inicioS: 0, nome: "m1", oQueFaz: "faz A", gancho: "gA" },
          { inicioS: 300, nome: "m2", oQueFaz: "faz B", gancho: "gB" },
          { inicioS: 500, nome: "m3", oQueFaz: "faz C", gancho: "gC" },
        ],
      },
      { ...CONTEXTO, capitulosDaDescricao: doDono },
    )!;
    expect(analise.capitulos.map((c) => c.oQueFaz)).toEqual(["faz A", "", "", "faz B", "", "faz C"]);
    // o gancho do último é sempre nulo, mesmo com par
    expect(analise.capitulos[5].gancho).toBeNull();
    expect(analise.capitulos[1].gancho).toBeNull();
  });

  it("caractere de controle (que o jsonb recusa) sai do texto, e os espaços se juntam", () => {
    const nulo = String.fromCharCode(0);
    const analise = conferirLeituraDoLongo({ ...SAIDA, assunto: `limpeza${nulo}de   sofá${String.fromCharCode(7)}` }, CONTEXTO)!;
    expect(analise.assunto).toBe("limpeza de sofá");
  });

  it("duas linhas na lista do dono não bastam como estrutura dele: valem os capítulos do modelo", () => {
    const analise = conferirLeituraDoLongo(SAIDA, { ...CONTEXTO, capitulosDaDescricao: [{ inicioS: 0, titulo: "Só" }, { inicioS: 50, titulo: "Duas" }] })!;
    expect(analise.origemDosCapitulos).toBe("leitura");
    expect(analise.capitulos.map((c) => c.nome)).toEqual(["Abertura", "O erro", "O jeito certo", "Fechamento"]);
  });

  it("dois capítulos do modelo com o mesmo início ficam como um só (o primeiro), sem perder os outros", () => {
    const analise = conferirLeituraDoLongo(
      {
        ...SAIDA,
        capitulos: [
          { inicioS: 0, nome: "A", oQueFaz: "x", gancho: null },
          { inicioS: 0, nome: "B repetido", oQueFaz: "x", gancho: null },
          { inicioS: 100, nome: "C", oQueFaz: "x", gancho: null },
          { inicioS: 200, nome: "D", oQueFaz: "x", gancho: null },
        ],
      },
      CONTEXTO,
    )!;
    expect(analise.capitulos.map((c) => c.nome)).toEqual(["A", "C", "D"]);
  });

  it("no máximo doze capítulos", () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({ inicioS: i * 20, nome: `c${i}`, oQueFaz: "x", gancho: "g" }));
    expect(conferirLeituraDoLongo({ ...SAIDA, capitulos: muitos }, CONTEXTO)!.capitulos).toHaveLength(12);
  });

  it("laço que 'pagou antes de prometer' fica como nunca pago, os laços saem em ordem e sem texto vazio", () => {
    const analise = conferirLeituraDoLongo(
      {
        ...SAIDA,
        lacos: [
          { abertoEmS: 300, pagoEmS: 100, oQue: "pagou antes" },
          { abertoEmS: 50, pagoEmS: 450, oQue: "pagou direito" },
          { abertoEmS: 70, pagoEmS: null, oQue: "   " },
        ],
      },
      CONTEXTO,
    )!;
    expect(analise.lacos).toEqual([
      { abertoEmS: 50, pagoEmS: 450, oQue: "pagou direito" },
      { abertoEmS: 300, pagoEmS: null, oQue: "pagou antes" },
    ]);
  });

  it("os pontos de saída: no máximo três, dentro do vídeo, em ordem", () => {
    const analise = conferirLeituraDoLongo(
      {
        ...SAIDA,
        ondeSairia: [
          { segundo: 500, porQue: "d" },
          { segundo: 100, porQue: "a" },
          { segundo: 900, porQue: "fora" },
          { segundo: 200, porQue: "b" },
          { segundo: 300, porQue: "c" },
        ],
      },
      CONTEXTO,
    )!;
    expect(analise.ondeSairia).toHaveLength(3);
    expect(analise.ondeSairia.map((s) => s.segundo)).toEqual([100, 200, 300].map((s) => s));
  });

  it("onde a abertura entrega não passa do fim do vídeo", () => {
    const analise = conferirLeituraDoLongo({ ...SAIDA, abertura: { ...SAIDA.abertura, entregaAteS: 5000 } }, CONTEXTO)!;
    expect(analise.abertura.entregaAteS).toBe(600);
    const nunca = conferirLeituraDoLongo({ ...SAIDA, abertura: { ...SAIDA.abertura, entregaAteS: null } }, CONTEXTO)!;
    expect(nunca.abertura.entregaAteS).toBeNull();
  });
});
