import { describe, expect, it } from "vitest";

import type { ConteudoRoteiro } from "@/db/schema";

import { dataPorExtenso, folhaDoRoteiro, LIMITE_DA_FALA_POR_UNIDADE, partirFala, temposDosBlocosReels } from "./folha-do-roteiro";
import type { VideoParaEmbed } from "./pesquisa";
import type { RoteiroLinha } from "./roteiro";

const conteudoBase: ConteudoRoteiro = {
  titulo: "O erro que faz a mancha voltar",
  duracaoS: 40,
  gancho: "Se a mancha volta dois dias depois, o problema é a ordem.",
  corpo: "Mostre a peça com a mancha de volta.\nExplique a ordem certa enquanto faz.",
  fechamento: "Mostre a peça limpa.",
  chamadaFinal: "Me manda uma mensagem que eu te digo qual produto usar.",
  cartoes: null,
  porQueAssim: [],
  cenas: [{ momento: "0 a 3 s", oQueFazer: "a peça com a mancha, em primeiro plano" }],
  ondeGravar: "na área de serviço",
  edicao: {
    textoNaTela: [
      { quando: "0 a 2 s", onde: "no topo", oQue: "a mancha voltou?" },
      { quando: "30 s", onde: "no centro", oQue: "me chama" },
    ],
    ritmoDeCorte: "Um corte a cada 4 ou 5 segundos. No trecho da aplicação, deixe correr sem cortar.",
    recursos: ["Aproxime a câmera na mancha."],
    audio: null,
    referencia: null,
  },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

function roteiro(parcial: Partial<RoteiroLinha> = {}, conteudo: Partial<ConteudoRoteiro> = {}): RoteiroLinha {
  return {
    id: 7,
    clienteId: 1,
    data: "2026-09-07",
    tema: "tema",
    origem: "livre",
    objetivo: "conversao",
    ficha: null,
    formato: "reels",
    estilo: "falado",
    objetivoDoVideo: null,
    referenciaVideoId: null,
    conteudo: { ...conteudoBase, ...conteudo },
    ...parcial,
  } as unknown as RoteiroLinha;
}

const video: VideoParaEmbed = {
  id: 3,
  plataforma: "instagram",
  url: "https://www.instagram.com/reel/exemplo/",
  contaNome: null,
  contaHandle: "@exemplo_limpeza",
  contaMedianaOrigem: "conta",
  foraDaCurva: 4.1,
  porQueFuncionou: "Mostrou o problema antes de explicar.",
  capaUrl: null,
  formatoCatalogo: "erro_comum",
};

describe("temposDosBlocosReels: os quatro tempos de um Reels falado", () => {
  it("a abertura até os 3 s, o meio até 65%, o fechamento até 85% e a chamada até o fim", () => {
    expect(temposDosBlocosReels(40)).toEqual(["0 a 3 s", "3 a 26 s", "26 a 34 s", "34 a 40 s"]);
    expect(temposDosBlocosReels(90)).toEqual(["0 a 3 s", "3 a 59 s", "59 a 77 s", "77 a 90 s"]);
  });

  it("em vídeo muito curto os limites se encostam em vez de se cruzar", () => {
    expect(temposDosBlocosReels(2)).toEqual(["0 a 2 s", "2 s", "2 s", "2 s"]);
    expect(temposDosBlocosReels(0)).toEqual(["0 a 1 s", "1 s", "1 s", "1 s"]);
  });
});

describe("folhaDoRoteiro: o roteiro como se imprime", () => {
  it("Reels falado: a marca e a data, os chips, o recado, os quatro blocos com tempo e o 'Como editar'", () => {
    const folha = folhaDoRoteiro(roteiro({ objetivoDoVideo: "  mostrar que a ordem importa  " }), "Casa em Ordem", null);
    expect(folha.marca).toBe("Casa em Ordem");
    expect(folha.dataLonga).toBe("segunda-feira, 7 de setembro de 2026");
    expect(folha.dataCurta).toBe("7 de setembro");
    expect(folha.chips).toEqual(["Reels", "40 segundos", "Para que te chamem"]);
    expect(folha.recado).toBe("mostrar que a ordem importa");
    expect(folha.nomeDoArquivo).toBe("roteiro-2026-09-07");

    const blocos = folha.unidades.filter((u) => u.rotulo);
    expect(blocos.map((b) => b.tempo)).toEqual(["0 a 3 s", "3 a 26 s", "26 a 34 s", "34 a 40 s"]);
    // O corpo tem dois parágrafos: duas unidades, o tempo só na primeira, e o que mostrar só na última do bloco.
    const meio = folha.unidades.filter((u, i) => i >= 1 && i <= 2);
    expect(meio.map((u) => u.fala)).toEqual(["Mostre a peça com a mancha de volta.", "Explique a ordem certa enquanto faz."]);
    expect(meio.map((u) => u.tempo)).toEqual(["3 a 26 s", null]);
    expect(meio.map((u) => u.fimDoBloco)).toEqual([false, true]);
    expect(folha.unidades[0].mostrar).toEqual(['Na tela (0 a 2 s): "a mancha voltou?"', "Mostrar: 0 a 3 s, a peça com a mancha, em primeiro plano"]);
    expect(meio[1].mostrar).toEqual([]);
    // O texto dos 30 s cai no fechamento (a partir de 65% da duração), pelo mesmo casamento do modo de leitura.
    expect(folha.unidades[3].mostrar).toEqual(['Na tela (30 s): "me chama"']);

    expect(folha.comoEditar?.map((item) => item.rotulo)).toEqual(["Texto na tela", "Ritmo de corte", "Recursos", "Áudio da semana"]);
    expect(folha.comoEditar?.[0].texto).toBe('0 a 2 s, "a mancha voltou?", no topo; 30 s, "me chama", no centro');
    // O pé da imagem: o ritmo de corte e, quando o roteiro diz, o áudio, uma frase de cada.
    expect(folha.linhaDoPe).toBe("Um corte a cada 4 ou 5 segundos.");
    const comAudio = folhaDoRoteiro(roteiro({}, { edicao: { ...conteudoBase.edicao, audio: "Sem áudio de fundo. Sua voz limpa funciona melhor." } }), "Casa em Ordem", null);
    expect(comAudio.linhaDoPe).toBe("Um corte a cada 4 ou 5 segundos. · Sem áudio de fundo.");
    expect(folha.deOndeVeio).toBeNull();
    expect(folha.legenda).toBeNull();
  });

  it("sem recado dito, o recado fica de fora", () => {
    expect(folhaDoRoteiro(roteiro({ objetivoDoVideo: "   " }), "Casa em Ordem", null).recado).toBeNull();
    expect(folhaDoRoteiro(roteiro({ objetivoDoVideo: null }), "Casa em Ordem", null).recado).toBeNull();
  });

  it("'De onde veio': a conta, o múltiplo, o trecho e o link no segundo, só com o vídeo e a referência", () => {
    const comReferencia = roteiro({}, { edicao: { ...conteudoBase.edicao, referencia: { videoId: 3, segundo: 4, oQueOlhar: "o antes" } } });
    const folha = folhaDoRoteiro(comReferencia, "Casa em Ordem", video);
    expect(folha.chips).toEqual(["Reels", "40 segundos", "Para que te chamem", "Tipo: erro comum"]);
    expect(folha.deOndeVeio).toEqual({
      conta: "@exemplo_limpeza",
      resumo: "4,1x acima do normal dessa conta. O que funcionou ali: mostrou o problema antes de explicar.",
      trecho: "O trecho que interessa começa em 0:04",
      link: { href: "https://www.instagram.com/reel/exemplo/", texto: "instagram.com/reel/exemplo/, a partir de 0:04" },
    });

    // Sem o segundo (ou no zero), o trecho some e o link fica sem "a partir de".
    const semSegundo = folhaDoRoteiro(roteiro({}, { edicao: { ...conteudoBase.edicao, referencia: { videoId: 3, segundo: 0, oQueOlhar: "" } } }), "Casa em Ordem", video);
    expect(semSegundo.deOndeVeio?.trecho).toBeNull();
    expect(semSegundo.deOndeVeio?.link?.texto).toBe("instagram.com/reel/exemplo/");
    // O vídeo sem referência no roteiro não vira "De onde veio".
    expect(folhaDoRoteiro(roteiro(), "Casa em Ordem", video).deOndeVeio).toBeNull();
  });

  it("Story: um bloco por cartão, sem tempo, sem 'Como editar' e sem os chips de para quê e de tipo", () => {
    const story = roteiro(
      { formato: "story" },
      {
        gancho: "",
        corpo: "",
        fechamento: "",
        chamadaFinal: "",
        cartoes: [
          { oQueFalar: "Bom dia, hoje tem mancha teimosa.", oQueMostrar: "a peça manchada", textoNaTela: "mancha teimosa", figurinha: "nenhuma" },
          { oQueFalar: "Já volto com o resultado.", oQueMostrar: "o produto", textoNaTela: "já volto", figurinha: "enquete" },
        ],
      },
    );
    const folha = folhaDoRoteiro(story, "Casa em Ordem", video);
    expect(folha.chips).toEqual(["Story", "40 segundos"]);
    expect(folha.comoEditar).toBeNull();
    expect(folha.linhaDoPe).toBeNull();
    // Os dois cartões e, no fim, "Onde gravar e o que mostrar" (as cenas): o PDF antigo e a tela mostram, e não estão nos blocos de cada cartão.
    expect(folha.unidades).toHaveLength(3);
    expect(folha.unidades.map((u) => u.tempo)).toEqual([null, null, null]);
    expect(folha.unidades[0].fala).toBe("Bom dia, hoje tem mancha teimosa.");
    expect(folha.unidades[1].mostrar.some((linha) => linha.startsWith("Figurinha:"))).toBe(true);
    expect(folha.unidades[2]).toEqual({ tempo: null, rotulo: "Onde gravar e o que mostrar", fala: null, mostrar: ["0 a 3 s: a peça com a mancha, em primeiro plano"], fimDoBloco: true });
  });

  it("vídeo sem fala: os cartões só com o que mostrar (nenhuma fala) e a legenda do post", () => {
    const semFala = roteiro(
      { estilo: "sem_fala" },
      {
        gancho: "",
        corpo: "",
        fechamento: "",
        chamadaFinal: "",
        legenda: "  Mancha que volta? Me chama.  ",
        cartoes: [{ oQueFalar: "", oQueMostrar: "a peça manchada", textoNaTela: "mancha que volta", figurinha: "nenhuma" }],
      },
    );
    const folha = folhaDoRoteiro(semFala, "Casa em Ordem", null);
    expect(folha.chips).toEqual(["Reels sem fala", "40 segundos", "Para que te chamem"]);
    expect(folha.unidades).toHaveLength(2);
    expect(folha.unidades[0].fala).toBeNull();
    expect(folha.unidades[0].mostrar).toEqual(["Mostrar: a peça manchada", 'Na tela: "mancha que volta"']);
    expect(folha.unidades[1].rotulo).toBe("Onde gravar e o que mostrar");
    expect(folha.legenda).toBe("Mancha que volta? Me chama.");
    expect(folha.comoEditar).toBeNull();
  });

  it("o pé da imagem leva só a primeira frase do ritmo de corte, e corta a que é longa demais", () => {
    const longo = roteiro({}, { edicao: { ...conteudoBase.edicao, ritmoDeCorte: "Corte a cada quatro segundos no começo e vá abrindo o ritmo conforme o vídeo avança até o final do roteiro. Depois descanse." } });
    const pe = folhaDoRoteiro(longo, "Casa em Ordem", null).linhaDoPe;
    expect(pe).not.toBeNull();
    expect(pe!.length).toBeLessThanOrEqual(90);
    expect(pe!.endsWith("…")).toBe(true);
    expect(folhaDoRoteiro(roteiro({}, { edicao: { ...conteudoBase.edicao, ritmoDeCorte: "  " } }), "Casa em Ordem", null).linhaDoPe).toBeNull();
  });
});

describe("partirFala: nenhuma unidade da imagem passa do quadro", () => {
  it("o parágrafo curto fica inteiro", () => {
    expect(partirFala("Uma frase só.")).toEqual(["Uma frase só."]);
  });

  it("o parágrafo comprido parte no fim de uma frase, sem perder nem repetir uma letra", () => {
    const frase = "Esta é uma frase de tamanho médio que se repete para o parágrafo passar do limite da unidade.";
    const paragrafo = Array.from({ length: 20 }, () => frase).join(" ");
    const pedacos = partirFala(paragrafo);
    expect(pedacos.length).toBeGreaterThan(2);
    for (const pedaco of pedacos) {
      expect(pedaco.length).toBeLessThanOrEqual(LIMITE_DA_FALA_POR_UNIDADE);
      expect(pedaco.endsWith(".")).toBe(true);
    }
    expect(pedacos.join(" ")).toBe(paragrafo);
  });

  it("a frase que sozinha passa do limite parte entre palavras, e o texto continua inteiro", () => {
    const frase = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(" ");
    const pedacos = partirFala(frase, 100);
    expect(pedacos.length).toBeGreaterThan(5);
    for (const pedaco of pedacos) expect(pedaco.length).toBeLessThanOrEqual(100);
    expect(pedacos.join(" ")).toBe(frase);
  });

  it("sem espaço nenhum (um endereço comprido), corta no limite em vez de ficar num pedaço só", () => {
    const pedacos = partirFala("a".repeat(250), 100);
    expect(pedacos.map((p) => p.length)).toEqual([100, 100, 50]);
  });
});

describe("folhaDoRoteiro: o que mostrar também cabe", () => {
  it("o parágrafo comprido do corpo vira várias unidades, o tempo só na primeira", () => {
    const frase = "Mostre a peça com a mancha de volta e conte o que você fez da primeira vez, sem cortar.";
    const folha = folhaDoRoteiro(roteiro({}, { corpo: Array.from({ length: 12 }, () => frase).join(" ") }), "Casa em Ordem", null);
    const doMeio = folha.unidades.filter((u) => u.fala?.startsWith("Mostre a peça com a mancha de volta e conte"));
    expect(doMeio.length).toBeGreaterThan(2);
    expect(doMeio.map((u) => u.tempo).filter(Boolean)).toEqual(["3 a 26 s"]);
    for (const unidade of doMeio) expect(unidade.fala!.length).toBeLessThanOrEqual(LIMITE_DA_FALA_POR_UNIDADE);
  });

  it("muitas cenas num bloco passam para unidades próprias, de até quatro linhas, e nenhuma se perde", () => {
    const cenas = Array.from({ length: 9 }, (_, i) => ({ momento: `${i} s`, oQueFazer: `cena ${i}` }));
    const folha = folhaDoRoteiro(roteiro({}, { cenas }), "Casa em Ordem", null);
    for (const unidade of folha.unidades) expect(unidade.mostrar.length).toBeLessThanOrEqual(4);
    const todas = folha.unidades.flatMap((u) => u.mostrar).filter((linha) => linha.startsWith("Mostrar:"));
    expect(todas).toHaveLength(9);
  });
});

describe("dataPorExtenso", () => {
  it("o dia, o mês por extenso e o ano, no fuso de São Paulo", () => {
    expect(dataPorExtenso("2026-09-07")).toBe("7 de setembro de 2026");
    expect(dataPorExtenso("2026-12-31")).toBe("31 de dezembro de 2026");
  });
});
