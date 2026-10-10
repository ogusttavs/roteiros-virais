import { describe, expect, it } from "vitest";

import type { ComentariosAnalise } from "@/db/schema";
import type { SaidaJuntarVozes } from "@/ia/prompts/juntarVozes";
import type { SaidaLerComentarios } from "@/ia/prompts/lerComentarios";

import { conferirLeitura, conferirVozes, itensParaJuntar, montarVozes, vozesSemOModelo, type ComentarioNumerado } from "./comentarios-do-publico";

const TRAVESSAO = String.fromCharCode(0x2014);

const COMENTARIOS: ComentarioNumerado[] = [
  { numero: 1, texto: "Serve em tecido de camurça?", curtidas: 14 },
  { numero: 2, texto: "Posso usar em sofá de camurça?", curtidas: 5 },
  { numero: 3, texto: "Quanto tempo tem que esperar para secar?", curtidas: 3 },
  { numero: 4, texto: "Não funcionou aqui em casa, a mancha voltou", curtidas: 2 },
  { numero: 5, texto: "Amei o resultado, ficou perfeito no meu sofá", curtidas: 1 },
];

function saida(parcial: Partial<SaidaLerComentarios>): SaidaLerComentarios {
  return { duvidas: [], objecoes: [], pedidos: [], oQueElogiaram: [], frasesDoPublico: [], sentimento: "dividido", ...parcial };
}

describe("conferirLeitura", () => {
  it("conta pelos números que existem: o número inventado não vale", () => {
    const leitura = conferirLeitura(
      saida({ duvidas: [{ texto: "Serve em tecido de camurça?", comentarios: [1, 2, 99, 100] }] }),
      COMENTARIOS,
    );
    expect(leitura.duvidas).toEqual([{ texto: "Serve em tecido de camurça?", vezes: 2 }]);
    expect(leitura.lidos).toBe(5);
  });

  it("um comentário conta uma vez por lista, mesmo que o modelo o ponha em dois itens", () => {
    const leitura = conferirLeitura(
      saida({
        duvidas: [
          { texto: "Serve em camurça?", comentarios: [1, 2, 1] },
          { texto: "Funciona em sofá de camurça?", comentarios: [2, 3] },
        ],
      }),
      COMENTARIOS,
    );
    expect(leitura.duvidas).toEqual([
      { texto: "Serve em camurça?", vezes: 2 },
      { texto: "Funciona em sofá de camurça?", vezes: 1 },
    ]);
  });

  it("dois itens que o modelo escreveu iguais são um só, com a soma", () => {
    const leitura = conferirLeitura(
      saida({
        duvidas: [
          { texto: "Serve em camurça?", comentarios: [1] },
          { texto: "serve em camurca", comentarios: [2] },
          { texto: "Quanto tempo tem que esperar?", comentarios: [3] },
        ],
      }),
      COMENTARIOS,
    );
    expect(leitura.duvidas).toEqual([
      { texto: "Serve em camurça?", vezes: 2 },
      { texto: "Quanto tempo tem que esperar?", vezes: 1 },
    ]);
  });

  it("o mesmo comentário pode estar em listas diferentes", () => {
    const leitura = conferirLeitura(
      saida({
        duvidas: [{ texto: "Quanto tempo tem que esperar?", comentarios: [3] }],
        objecoes: [{ texto: "Demora para secar", comentarios: [3] }],
      }),
      COMENTARIOS,
    );
    expect(leitura.duvidas).toHaveLength(1);
    expect(leitura.objecoes).toHaveLength(1);
  });

  it("descarta o item sem nenhum número válido e o texto que não é frase", () => {
    const leitura = conferirLeitura(
      saida({
        duvidas: [
          { texto: "Frase sem comentário nenhum atrás", comentarios: [42] },
          { texto: "ok", comentarios: [1] },
          { texto: "Serve em camurça?", comentarios: [1] },
        ],
      }),
      COMENTARIOS,
    );
    expect(leitura.duvidas).toEqual([{ texto: "Serve em camurça?", vezes: 1 }]);
  });

  it("limpa o texto do item: sem travessão, @ nem endereço", () => {
    const leitura = conferirLeitura(
      saida({ duvidas: [{ texto: `Serve em camurça ${TRAVESSAO} e em linho? @loja www.exemplo.invalido`, comentarios: [1] }] }),
      COMENTARIOS,
    );
    expect(leitura.duvidas[0].texto).toBe("Serve em camurça, e em linho?");
  });

  it("ordena por quantas vezes, do mais repetido para o menos", () => {
    const leitura = conferirLeitura(
      saida({
        duvidas: [
          { texto: "Pergunta que apareceu uma vez", comentarios: [3] },
          { texto: "Pergunta que apareceu duas vezes", comentarios: [1, 2] },
        ],
      }),
      COMENTARIOS,
    );
    expect(leitura.duvidas.map((d) => d.vezes)).toEqual([2, 1]);
  });

  it("a frase literal só entra se está mesmo no comentário indicado", () => {
    const leitura = conferirLeitura(
      saida({
        frasesDoPublico: [
          { comentario: 5, trecho: "ficou perfeito no meu sofá" },
          { comentario: 5, trecho: "ficou horrível no meu sofá" },
          { comentario: 1, trecho: "ficou perfeito no meu sofá" },
          { comentario: 77, trecho: "ficou perfeito no meu sofá" },
          { comentario: 5, trecho: "Ficou perfeito no meu sofa" },
        ],
      }),
      COMENTARIOS,
    );
    expect(leitura.frasesDoPublico).toEqual(["ficou perfeito no meu sofá"]);
  });

  it("guarda o sentimento do modelo", () => {
    expect(conferirLeitura(saida({ sentimento: "mais_positivo" }), COMENTARIOS).sentimento).toBe("mais_positivo");
  });
});

function analise(parcial: Partial<ComentariosAnalise>): ComentariosAnalise {
  return { duvidas: [], objecoes: [], pedidos: [], oQueElogiaram: [], frasesDoPublico: [], sentimento: "dividido", lidos: 50, ...parcial };
}

const LEITURAS = [
  { videoId: 10, plataforma: "youtube" as const, analise: analise({ duvidas: [{ texto: "Serve em tecido de camurça?", vezes: 6 }], objecoes: [{ texto: "A mancha voltou depois de secar", vezes: 3 }] }) },
  { videoId: 11, plataforma: "youtube" as const, analise: analise({ duvidas: [{ texto: "Posso usar em sofá de camurça?", vezes: 4 }, { texto: "Quanto tempo tem que esperar?", vezes: 2 }], pedidos: [{ texto: "Mostrar no colchão", vezes: 2 }] }) },
];

describe("itensParaJuntar", () => {
  it("numera de 1, na ordem, com o tipo e o vídeo de cada um", () => {
    const itens = itensParaJuntar(LEITURAS);
    expect(itens.map((i) => [i.numero, i.tipo, i.videoId, i.vezes])).toEqual([
      [1, "duvida", 10, 6],
      [2, "objecao", 10, 3],
      [3, "duvida", 11, 4],
      [4, "duvida", 11, 2],
      [5, "pedido", 11, 2],
    ]);
  });
});

describe("conferirVozes", () => {
  const itens = itensParaJuntar(LEITURAS);

  it("soma as vezes do grupo e junta os vídeos de origem", () => {
    const juntas = conferirVozes(
      { grupos: [{ tipo: "duvida", texto: "Serve em tecido de camurça?", itens: [1, 3] }] },
      itens,
    );
    expect(juntas.duvida[0]).toEqual({ texto: "Serve em tecido de camurça?", vezes: 10, videos: [10, 11], plataformas: ["youtube"] });
  });

  it("o item que o modelo esqueceu vira um grupo de um item só: nada se perde", () => {
    const juntas = conferirVozes({ grupos: [{ tipo: "duvida", texto: "Serve em tecido de camurça?", itens: [1, 3] }] }, itens);
    expect(juntas.duvida.map((v) => v.texto)).toContain("Quanto tempo tem que esperar?");
    expect(juntas.objecao).toEqual([{ texto: "A mancha voltou depois de secar", vezes: 3, videos: [10], plataformas: ["youtube"] }]);
    expect(juntas.pedido).toEqual([{ texto: "Mostrar no colchão", vezes: 2, videos: [11], plataformas: ["youtube"] }]);
  });

  it("não deixa um item contar em dois grupos, nem juntar tipos diferentes", () => {
    const juntas = conferirVozes(
      {
        grupos: [
          { tipo: "duvida", texto: "Serve em camurça?", itens: [1, 3, 2] },
          { tipo: "duvida", texto: "Outra frase para o mesmo item", itens: [1] },
        ],
      },
      itens,
    );
    // o item 2 é objeção: fica fora do grupo de dúvida e volta sozinho; o 1 não conta duas vezes
    expect(juntas.duvida.find((v) => v.texto === "Serve em camurça?")).toEqual({ texto: "Serve em camurça?", vezes: 10, videos: [10, 11], plataformas: ["youtube"] });
    expect(juntas.duvida.find((v) => v.texto === "Outra frase para o mesmo item")).toBeUndefined();
    expect(juntas.objecao[0].vezes).toBe(3);
  });

  it("ignora número que não existe", () => {
    const juntas = conferirVozes({ grupos: [{ tipo: "duvida", texto: "Pergunta de um item que não existe", itens: [900, 901] }] }, itens);
    expect(juntas.duvida.map((v) => v.texto)).not.toContain("Pergunta de um item que não existe");
  });

  it("ordena do mais repetido para o menos e respeita o máximo de cada tipo", () => {
    const muitos: SaidaJuntarVozes = { grupos: [] };
    const base = itensParaJuntar([
      { videoId: 1, plataforma: "youtube" as const, analise: analise({ duvidas: Array.from({ length: 14 }, (_, i) => ({ texto: `Pergunta número ${i + 1} do público`, vezes: i + 1 })) }) },
    ]);
    const juntas = conferirVozes(muitos, base);
    expect(juntas.duvida).toHaveLength(10);
    expect(juntas.duvida[0].vezes).toBe(14);
    expect(juntas.duvida.map((v) => v.vezes)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });
});

describe("vozesSemOModelo", () => {
  it("junta só o que está escrito igual, sem olhar acento, maiúscula nem pontuação", () => {
    const itens = itensParaJuntar([
      { videoId: 1, plataforma: "youtube" as const, analise: analise({ duvidas: [{ texto: "Serve em tecido de camurça?", vezes: 5 }] }) },
      { videoId: 2, plataforma: "youtube" as const, analise: analise({ duvidas: [{ texto: "serve em tecido de camurca", vezes: 4 }, { texto: "Posso usar em sofá de camurça?", vezes: 3 }] }) },
    ]);
    const juntas = vozesSemOModelo(itens);
    expect(juntas.duvida).toEqual([
      { texto: "Serve em tecido de camurça?", vezes: 9, videos: [1, 2], plataformas: ["youtube"] },
      { texto: "Posso usar em sofá de camurça?", vezes: 3, videos: [2], plataformas: ["youtube"] },
    ]);
  });
});

describe("montarVozes", () => {
  it("põe os tipos nas listas certas e diz quantos vídeos e comentários entraram", () => {
    const vozes = montarVozes({ duvida: [{ texto: "a", vezes: 1, videos: [1], plataformas: ["youtube"] }], objecao: [], pedido: [] }, { videos: 7, comentarios: 640, plataformas: ["youtube", "youtube"] });
    expect(vozes).toEqual({ duvidas: [{ texto: "a", vezes: 1, videos: [1], plataformas: ["youtube"] }], objecoes: [], pedidos: [], videos: 7, comentarios: 640, plataformas: ["youtube"] });
  });
});
