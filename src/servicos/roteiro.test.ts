import { describe, expect, it } from "vitest";

import type { CartaoStory, ConteudoRoteiro, TipoAbertura } from "@/db/schema";

import { blocosParaLeitura, escolherTipoAbertura, type RoteiroLinha } from "./roteiro";

function evidencia(
  tipoAbertura: TipoAbertura | null,
  foraDaCurva: number,
  gancho: string,
  contaBrasileira = true,
): { tipoAbertura: TipoAbertura | null; foraDaCurva: number; contaBrasileira: boolean; gancho: string } {
  return { tipoAbertura, foraDaCurva, contaBrasileira, gancho };
}

/**
 * V4, item 3: função pura, testada com tabela de casos. Cobre as cinco
 * alíneas do plano (a a e) uma a uma.
 */
describe("escolherTipoAbertura", () => {
  it("(a e c) sem historico, escolhe o tipo de evidencia mais forte (maior fora da curva)", () => {
    const instrucao = escolherTipoAbertura(
      [evidencia("cena", 3, "olha essa cena"), evidencia("resultado", 8, "olha o resultado")],
      [],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "olha o resultado" });
  });

  it("(c) empate no fora da curva: o brasileiro vence", () => {
    const instrucao = escolherTipoAbertura(
      [
        evidencia("cena", 5, "gancho internacional", false),
        evidencia("resultado", 5, "gancho brasileiro", true),
      ],
      [],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "gancho brasileiro" });
  });

  it("(b) tira da escolha o tipo ja usado nos ultimos roteiros, mesmo sendo o mais forte", () => {
    const instrucao = escolherTipoAbertura(
      [evidencia("cena", 9, "gancho forte"), evidencia("resultado", 2, "gancho fraco")],
      ["cena"],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "gancho fraco" });
  });

  it("(b) ignora nulo na lista de ultimos tipos (roteiro de antes desta coluna existir)", () => {
    const instrucao = escolherTipoAbertura([evidencia("cena", 5, "gancho")], [null, null]);
    expect(instrucao).toEqual({ tipo: "cena", ganchoExemplo: "gancho" });
  });

  it("(d) nenhum tipo sobra fora dos ultimos usados: libera o usado ha mais tempo", () => {
    // "cena" e "resultado" sao os dois unicos tipos da evidencia, e os dois ja
    // apareceram nos ultimos roteiros; "cena" foi usado mais recentemente
    // (indice 0), "resultado" ha mais tempo (indice 2): libera "resultado".
    const instrucao = escolherTipoAbertura(
      [evidencia("cena", 9, "gancho cena"), evidencia("resultado", 2, "gancho resultado")],
      ["cena", "outro", "resultado"],
    );
    expect(instrucao).toEqual({ tipo: "resultado", ganchoExemplo: "gancho resultado" });
  });

  it("(d) com um unico tipo na evidencia, sempre libera ele de novo (nada mais para escolher)", () => {
    const instrucao = escolherTipoAbertura([evidencia("cena", 9, "gancho")], ["cena"]);
    expect(instrucao).toEqual({ tipo: "cena", ganchoExemplo: "gancho" });
  });

  it("(e) nenhuma evidencia tem tipo (nicho novo): so a lista do que evitar, sem tipo escolhido", () => {
    const instrucao = escolherTipoAbertura(
      [evidencia(null, 6, "gancho sem tipo")],
      ["cena", "resultado", "cena"],
    );
    expect(instrucao).toEqual({ tipo: null, tiposProibidos: expect.arrayContaining(["cena", "resultado"]) });
    expect((instrucao as { tiposProibidos: string[] }).tiposProibidos).toHaveLength(2);
  });

  it("(e) sem evidencia nenhuma e sem historico: livre, nada a evitar", () => {
    const instrucao = escolherTipoAbertura([], []);
    expect(instrucao).toEqual({ tipo: null, tiposProibidos: [] });
  });
});

function conteudoBase(sobrepor: Partial<ConteudoRoteiro> = {}): ConteudoRoteiro {
  return {
    titulo: "titulo de teste",
    duracaoS: 40,
    gancho: "gancho de teste",
    corpo: "corpo de teste",
    fechamento: "fechamento de teste",
    chamadaFinal: "chamada de teste",
    cartoes: null,
    porQueAssim: [],
    cenas: [],
    ondeGravar: "no proprio negocio",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    ...sobrepor,
  };
}

function roteiroDeTeste(formato: "reels" | "story", conteudo: ConteudoRoteiro): RoteiroLinha {
  return { formato, conteudo } as RoteiroLinha;
}

/**
 * V11, item 6: o que mostrar em cada bloco, junto da fala (`GravacaoTela.tsx`), sem mudar o que o
 * PDF e `RoteiroTela.tsx` já mostravam (o campo é opcional, os dois ignoram).
 */
describe("blocosParaLeitura, o campo mostrar", () => {
  it("Story: cada cartão traz o que mostrar, o texto na tela e a figurinha quando não é nenhuma", () => {
    const cartaoComFigurinha: CartaoStory = {
      oQueFalar: "fala do cartao 1",
      oQueMostrar: "o produto na bancada",
      textoNaTela: "3 passos",
      figurinha: "enquete",
    };
    const cartaoSemFigurinha: CartaoStory = {
      oQueFalar: "fala do cartao 2",
      oQueMostrar: "o resultado pronto",
      textoNaTela: "pronto",
      figurinha: "nenhuma",
    };
    const roteiro = roteiroDeTeste("story", conteudoBase({ cartoes: [cartaoComFigurinha, cartaoSemFigurinha] }));

    const blocos = blocosParaLeitura(roteiro);

    expect(blocos[0].mostrar).toEqual([
      "Mostrar: o produto na bancada",
      'Na tela: "3 passos"',
      expect.stringContaining("Figurinha:"),
    ]);
    expect(blocos[1].mostrar).toEqual(["Mostrar: o resultado pronto", 'Na tela: "pronto"']);
  });

  it("Reels: só os itens de textoNaTela cujo quando bate com o bloco, os outros ficam de fora", () => {
    const roteiro = roteiroDeTeste(
      "reels",
      conteudoBase({
        edicao: {
          textoNaTela: [
            { quando: "na abertura", oQue: "titulo do vídeo", onde: "topo" },
            { quando: "no fechamento", oQue: "resumo em tela", onde: "centro" },
            { quando: "um momento qualquer, sem palavra-chave", oQue: "nunca deve aparecer", onde: "rodapé" },
          ],
          ritmoDeCorte: "moderado",
          recursos: [],
          audio: null,
          referencia: null,
        },
      }),
    );

    const [abertura, meio, fechamento, chamada] = blocosParaLeitura(roteiro);

    expect(abertura.mostrar).toEqual(['Na tela: "titulo do vídeo"']);
    expect(meio.mostrar).toEqual([]);
    expect(fechamento.mostrar).toEqual(['Na tela: "resumo em tela"']);
    expect(chamada.mostrar).toEqual([]);
    expect(blocosParaLeitura(roteiro).flatMap((b) => b.mostrar ?? [])).not.toContain(
      expect.stringContaining("nunca deve aparecer"),
    );
  });

  it("Reels: sem nenhum item de textoNaTela, mostrar vem vazio em todo bloco (nunca undefined)", () => {
    const roteiro = roteiroDeTeste("reels", conteudoBase());

    for (const bloco of blocosParaLeitura(roteiro)) {
      expect(bloco.mostrar).toEqual([]);
    }
  });
});
