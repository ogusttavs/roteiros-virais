import { describe, expect, it } from "vitest";

import type { CartaoStory, ConteudoRoteiro, TipoAbertura } from "@/db/schema";

import {
  blocosParaLeitura,
  ErroRoteiro,
  escolherTipoAbertura,
  formatarCamadaExclusiva,
  validarQuemAparece,
  type RoteiroLinha,
} from "./roteiro";

const CAMADA_VAZIA = { concorrentes: [], termos: [], perfisAdmirados: [] };

/** V12c, item 1 (a E37b): cidade/bairro saíram, alcance/regiao entraram no lugar. */
describe("formatarCamadaExclusiva", () => {
  it("brasil: diz para nao citar cidade nem bairro", () => {
    const texto = formatarCamadaExclusiva({
      alcance: "brasil",
      regiao: null,
      pais: null,
      paises: null,
      camadaExclusiva: CAMADA_VAZIA,
    });
    expect(texto).toContain("Brasil inteiro");
    expect(texto).toContain("não cite cidade nem bairro");
  });

  it("local: cita a regiao escrita pelo cliente", () => {
    const texto = formatarCamadaExclusiva({
      alcance: "local",
      regiao: "Campinas e região",
      pais: null,
      paises: null,
      camadaExclusiva: CAMADA_VAZIA,
    });
    expect(texto).toContain("Campinas e região");
  });

  it("local sem regiao (dado incompleto): nao quebra, so nao cita nada de local", () => {
    const texto = formatarCamadaExclusiva({
      alcance: "local",
      regiao: null,
      pais: null,
      paises: null,
      camadaExclusiva: CAMADA_VAZIA,
    });
    expect(texto).not.toContain("Região:");
  });

  /** E42a, item 1: o motor nao muda (a pesquisa continua so no Brasil), so o roteiro sabe o pais. */
  it("outro_pais: cita o pais escrito, nao cidade nem bairro do Brasil", () => {
    const texto = formatarCamadaExclusiva({
      alcance: "outro_pais",
      regiao: null,
      pais: "Portugal",
      paises: null,
      camadaExclusiva: CAMADA_VAZIA,
    });
    expect(texto).toContain("Portugal");
    expect(texto).toContain("não cite cidade nem bairro do Brasil");
  });

  it("outro_pais sem pais (dado incompleto): nao quebra, so nao cita nada de pais", () => {
    const texto = formatarCamadaExclusiva({
      alcance: "outro_pais",
      regiao: null,
      pais: null,
      paises: null,
      camadaExclusiva: CAMADA_VAZIA,
    });
    expect(texto).not.toContain("Público no exterior");
  });

  it("mais_de_um_pais: cita os paises escritos, nao cidade nem bairro do Brasil", () => {
    const texto = formatarCamadaExclusiva({
      alcance: "mais_de_um_pais",
      regiao: null,
      pais: null,
      paises: "Estados Unidos e México",
      camadaExclusiva: CAMADA_VAZIA,
    });
    expect(texto).toContain("Estados Unidos e México");
    expect(texto).toContain("não cite cidade nem bairro do Brasil");
  });

  it("sem alcance (cliente nunca passou pela tela nova): segue so com o resto da camada", () => {
    const texto = formatarCamadaExclusiva({
      alcance: null,
      regiao: null,
      pais: null,
      paises: null,
      camadaExclusiva: { ...CAMADA_VAZIA, concorrentes: ["Clínica Popular"] },
    });
    expect(texto).not.toContain("Brasil inteiro");
    expect(texto).not.toContain("Região:");
    expect(texto).toContain("Clínica Popular");
  });
});

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

  /**
   * Revisão do PR #62, item 1: valores exatos conferidos no banco de produção (30 itens de
   * `edicao.textoNaTela` em cinco roteiros de Reels), sempre em segundos ou "Do começo ao fim",
   * nunca com as palavras que a primeira versão desta rodada tentava casar.
   */
  it("Reels: casa cada item pela posição do primeiro número do quando dentro da duração, não por palavra-chave", () => {
    const roteiro = roteiroDeTeste(
      "reels",
      conteudoBase({
        duracaoS: 48,
        edicao: {
          textoNaTela: [
            { quando: "0 a 5 segundos", oQue: "titulo do vídeo", onde: "topo" },
            { quando: "12 a 22 segundos", oQue: "o preço", onde: "centro" },
            { quando: "35 a 42 segundos", oQue: "antes e depois", onde: "canto" },
            { quando: "42 a 48 segundos", oQue: "chama no direct", onde: "rodapé" },
            { quando: "Do começo ao fim", oQue: "nome da marca", onde: "canto superior" },
          ],
          ritmoDeCorte: "moderado",
          recursos: [],
          audio: null,
          referencia: null,
        },
      }),
    );

    const [abertura, meio, fechamento, chamada] = blocosParaLeitura(roteiro);

    expect(abertura.mostrar).toEqual([
      'Na tela (0 a 5 segundos): "titulo do vídeo"',
      'Na tela (Do começo ao fim): "nome da marca"',
    ]);
    expect(meio.mostrar).toEqual(['Na tela (12 a 22 segundos): "o preço"']);
    expect(fechamento.mostrar).toEqual(['Na tela (35 a 42 segundos): "antes e depois"']);
    expect(chamada.mostrar).toEqual(['Na tela (42 a 48 segundos): "chama no direct"']);
  });

  it("Reels: um número com 's' colado (\"8s a 12s\") ou um número só (\"26 segundos\") também casam pelo primeiro número", () => {
    const roteiro = roteiroDeTeste(
      "reels",
      conteudoBase({
        duracaoS: 30,
        edicao: {
          textoNaTela: [
            { quando: "8s a 12s", oQue: "primeiro item", onde: "topo" },
            { quando: "26 segundos", oQue: "segundo item", onde: "centro" },
          ],
          ritmoDeCorte: "moderado",
          recursos: [],
          audio: null,
          referencia: null,
        },
      }),
    );

    // Com 30s de duração: 8 fica entre o limiar de abertura (3s) e o de fechamento (65% = 19,5s), cai no meio;
    // 26 já passa do limiar de chamada (85% = 25,5s).
    const [abertura, meio, fechamento, chamada] = blocosParaLeitura(roteiro);

    expect(abertura.mostrar).toEqual([]);
    expect(meio.mostrar).toEqual(['Na tela (8s a 12s): "primeiro item"']);
    expect(fechamento.mostrar).toEqual([]);
    expect(chamada.mostrar).toEqual(['Na tela (26 segundos): "segundo item"']);
  });

  it("Reels: sem nenhum item de textoNaTela, mostrar vem vazio em todo bloco (nunca undefined)", () => {
    const roteiro = roteiroDeTeste("reels", conteudoBase());

    for (const bloco of blocosParaLeitura(roteiro)) {
      expect(bloco.mostrar).toEqual([]);
    }
  });
});

/** V12c, item 3, a E37b: mesmo cuidado de validarFormato/validarEstilo para o valor vindo do navegador. */
describe("validarQuemAparece", () => {
  it("undefined ou vazio voltam undefined (usa o quemGrava do cliente)", () => {
    expect(validarQuemAparece(undefined)).toBeUndefined();
    expect(validarQuemAparece("")).toBeUndefined();
  });

  it("aceita os quatro valores", () => {
    for (const valor of ["propria_pessoa", "pessoa_e_equipe", "equipe", "outra_pessoa"]) {
      expect(validarQuemAparece(valor)).toBe(valor);
    }
  });

  it("recusa valor fora da lista", () => {
    expect(() => validarQuemAparece("dono-disfarcado")).toThrow(ErroRoteiro);
  });
});
