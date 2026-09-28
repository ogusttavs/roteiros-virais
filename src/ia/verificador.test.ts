import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const gerarEstruturadoMock = vi.fn();
const registrarGeracaoMock = vi.fn().mockResolvedValue(1);

vi.mock("./cliente", () => ({
  gerarEstruturado: (...args: unknown[]) => gerarEstruturadoMock(...args),
}));
vi.mock("./registro", () => ({
  registrarGeracao: (...args: unknown[]) => registrarGeracaoMock(...args),
}));

import type { CartaoStory } from "@/db/schema";

import { ErroIA } from "./erro";
import { gerarComVerificacao, palavrasDeConteudo, verificarLocalmente } from "./verificador";

const usoZero = { tokensEntrada: 0, tokensSaida: 0, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };

describe("verificarLocalmente", () => {
  it("reprova travessao", () => {
    const r = verificarLocalmente({ corpo: "um texto \u2014 com travessao" });
    expect(r.aprovado).toBe(false);
  });

  it("reprova emoji", () => {
    const r = verificarLocalmente({ corpo: "seu roteiro esta pronto \u{1F389}" });
    expect(r.aprovado).toBe(false);
  });

  it("reprova jargao", () => {
    const r = verificarLocalmente({ corpo: "isso aumenta o engajamento" });
    expect(r.aprovado).toBe(false);
  });

  it("aceita gancho, que e permitido", () => {
    const r = verificarLocalmente({ corpo: "o gancho do video e forte" });
    expect(r.aprovado).toBe(true);
  });

  it("reprova quando exige evidencia e nao ha nenhuma", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { exigeEvidencia: true, evidencias: [] },
    );
    expect(r.aprovado).toBe(false);
    expect(r.motivos.join(" ")).toContain("evidencia");
  });

  it("aprova com evidencia quando exigida", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { exigeEvidencia: true, evidencias: [1, 2] },
    );
    expect(r.aprovado).toBe(true);
  });

  it("reprova quando fere uma proibicao do cliente", () => {
    const r = verificarLocalmente(
      { corpo: "aqui a gente da garantia total para todo mundo" },
      { proibicoes: ["garantia total"] },
    );
    expect(r.aprovado).toBe(false);
  });

  it("aprova texto limpo sem proibicao nem exigencia de evidencia", () => {
    const r = verificarLocalmente({ corpo: "um texto direto e calmo" });
    expect(r.aprovado).toBe(true);
    expect(r.motivos).toEqual([]);
  });

  it("reprova id de evidencia inventado, fora da lista fornecida (revisao do PR #17)", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { evidencias: [255, 359], evidenciasFornecidas: [65, 80] },
    );
    expect(r.aprovado).toBe(false);
    expect(r.motivos.join(" ")).toContain("nao foi fornecida");
    expect(r.motivos.join(" ")).toContain("255");
    expect(r.motivos.join(" ")).toContain("359");
  });

  it("aprova quando todo id citado esta entre os fornecidos", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { evidencias: [65], evidenciasFornecidas: [65, 80] },
    );
    expect(r.aprovado).toBe(true);
  });

  it("aprova lista vazia de evidencias quando fornecidas tambem e vazia e nao exige evidencia", () => {
    const r = verificarLocalmente(
      { corpo: "texto limpo" },
      { evidencias: [], evidenciasFornecidas: [], exigeEvidencia: false },
    );
    expect(r.aprovado).toBe(true);
  });

  describe("ganchosRecentes (achado do primeiro uso no iPad, item 3)", () => {
    it("reprova gancho identico a um recente", () => {
      const r = verificarLocalmente(
        { gancho: "voce ja tentou tirar mancha de vinho do sofa e nao conseguiu?", corpo: "texto" },
        { ganchosRecentes: ["voce ja tentou tirar mancha de vinho do sofa e nao conseguiu?"] },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("gancho");
    });

    it("reprova parafrase: mesmas seis primeiras palavras, sem acento, sem pontuacao e sem ligar para maiuscula", () => {
      const r = verificarLocalmente(
        { gancho: "Você já tentou tirar mancha de vinho, sem sucesso?", corpo: "texto" },
        { ganchosRecentes: ["voce ja tentou tirar mancha de vinho e nao conseguiu"] },
      );
      expect(r.aprovado).toBe(false);
    });

    it("aprova gancho que comeca diferente, mesmo tema", () => {
      const r = verificarLocalmente(
        { gancho: "isso aqui muda a forma como voce limpa o estofado", corpo: "texto" },
        { ganchosRecentes: ["voce ja tentou tirar mancha de vinho e nao conseguiu"] },
      );
      expect(r.aprovado).toBe(true);
    });

    it("aprova quando nao ha campo gancho, mesmo com a lista preenchida", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { ganchosRecentes: ["qualquer gancho recente"] },
      );
      expect(r.aprovado).toBe(true);
    });

    it("aprova quando nao ha gancho recente nenhum", () => {
      const r = verificarLocalmente(
        { gancho: "gancho novo", corpo: "texto" },
        { ganchosRecentes: [] },
      );
      expect(r.aprovado).toBe(true);
    });
  });

  describe("duracaoParaMuitoLongo (E27, parte 1, item 4)", () => {
    it("reprova quando a nova versao nao ficou mais curta que a reprovada", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { duracaoParaMuitoLongo: { anteriorS: 40, novaS: 40 } },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("duracao");
    });

    it("reprova quando a nova versao ficou mais longa ainda", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { duracaoParaMuitoLongo: { anteriorS: 40, novaS: 55 } },
      );
      expect(r.aprovado).toBe(false);
    });

    it("aprova quando a nova versao ficou mais curta", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { duracaoParaMuitoLongo: { anteriorS: 40, novaS: 28 } },
      );
      expect(r.aprovado).toBe(true);
    });

    it("sem duracaoParaMuitoLongo, nao reprova por duracao nenhuma", () => {
      const r = verificarLocalmente({ corpo: "texto limpo" });
      expect(r.aprovado).toBe(true);
    });
  });

  describe("ganchosUltimos5, a primeira palavra (V4, item 5)", () => {
    it("reprova quando a primeira palavra repete a de um dos ultimos 5, mesmo com o resto diferente", () => {
      const r = verificarLocalmente(
        { gancho: "Espera, isso muda tudo no seu atendimento", corpo: "texto" },
        { ganchosUltimos5: ["Espera ai que eu vou te mostrar uma coisa"] },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("primeira palavra");
    });

    it("aprova quando a primeira palavra e diferente, mesmo com o resto do gancho parecido", () => {
      const r = verificarLocalmente(
        { gancho: "Olha isso muda tudo no seu atendimento", corpo: "texto" },
        { ganchosUltimos5: ["Espera ai que eu vou te mostrar uma coisa"] },
      );
      expect(r.aprovado).toBe(true);
    });

    it("aprova quando a lista dos ultimos 5 esta vazia", () => {
      const r = verificarLocalmente(
        { gancho: "Espera, isso muda tudo", corpo: "texto" },
        { ganchosUltimos5: [] },
      );
      expect(r.aprovado).toBe(true);
    });
  });

  describe("tipoAbertura contra o roteiro anterior (V4, item 5)", () => {
    it("reprova quando o tipo declarado repete o do roteiro anterior", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { tipoAberturaAtual: "cena", tipoAberturaAnterior: "cena" },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("tipoAbertura");
    });

    it("aprova quando o tipo declarado e diferente do anterior", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { tipoAberturaAtual: "cena", tipoAberturaAnterior: "resultado" },
      );
      expect(r.aprovado).toBe(true);
    });

    it("aprova sem tipoAberturaAnterior (primeiro roteiro do cliente, ou reuso liberado de proposito pelo servico)", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        { tipoAberturaAtual: "cena", tipoAberturaAnterior: null },
      );
      expect(r.aprovado).toBe(true);
    });
  });

  describe("tipoAbertura contra a instrucao do servico (V5, item 0b)", () => {
    it("reprova quando o servico instruiu um tipo concreto e o modelo declarou outro", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        {
          tipoAberturaAtual: "cena",
          instrucaoAbertura: { tipo: "resultado", ganchoExemplo: null },
        },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("tipoAbertura");
    });

    it("aprova quando o modelo declara o mesmo tipo concreto instruido", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        {
          tipoAberturaAtual: "resultado",
          instrucaoAbertura: { tipo: "resultado", ganchoExemplo: null },
        },
      );
      expect(r.aprovado).toBe(true);
    });

    it("reprova quando a instrucao era livre e o tipo declarado esta na lista dos proibidos", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        {
          tipoAberturaAtual: "cena",
          instrucaoAbertura: { tipo: null, tiposProibidos: ["cena", "resultado"] },
        },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("tipoAbertura");
    });

    it("aprova quando a instrucao era livre e o tipo declarado nao esta na lista dos proibidos", () => {
      const r = verificarLocalmente(
        { corpo: "texto limpo" },
        {
          tipoAberturaAtual: "cena",
          instrucaoAbertura: { tipo: null, tiposProibidos: ["resultado"] },
        },
      );
      expect(r.aprovado).toBe(true);
    });
  });

  // V9a, item 2: com o momento, o gancho precisa citar pelo menos um elemento concreto do que a pessoa descreveu.
  describe("palavrasDoMomento (V9a, item 2)", () => {
    const PALAVRAS = palavrasDeConteudo("no aeroporto esperando o embarque para a feira de fornecedores");

    it("cita uma palavra do momento no gancho: aprova", () => {
      const r = verificarLocalmente(
        { gancho: "aqui no aeroporto, cinco da manha, ja com a mala pronta" },
        { palavrasDoMomento: PALAVRAS },
      );
      expect(r.aprovado).toBe(true);
    });

    it("nao cita nenhuma palavra do momento no gancho: reprova", () => {
      const r = verificarLocalmente(
        { gancho: "olha essa novidade que eu trouxe para voce hoje" },
        { palavrasDoMomento: PALAVRAS },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("elemento concreto do momento");
    });

    it("cita a palavra so no corpo, nunca no gancho: reprova (a regra e sobre os primeiros segundos)", () => {
      const r = verificarLocalmente(
        {
          gancho: "olha essa novidade que eu trouxe para voce hoje",
          corpo: "estou aqui no aeroporto esperando o embarque para a feira de fornecedores",
        },
        { palavrasDoMomento: PALAVRAS },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("elemento concreto do momento");
    });

    it("sem palavrasDoMomento (fora da origem momento), nao aplica a checagem", () => {
      const r = verificarLocalmente({ gancho: "olha essa novidade que eu trouxe para voce hoje" });
      expect(r.aprovado).toBe(true);
    });
  });

  // V9c, item 3: as checagens da seção 9.1 conferíveis por código, só com formato "story".
  describe("cartoes de Story (V9c, item 3)", () => {
    const CARTAO_OK: CartaoStory = {
      oQueFalar: "hoje eu vou te mostrar como a gente resolve isso aqui no dia a dia",
      oQueMostrar: "o balcao de atendimento com o produto em cima",
      textoNaTela: "como resolver isso",
      figurinha: "nenhuma",
    };
    const ULTIMO_CARTAO_OK: CartaoStory = {
      ...CARTAO_OK,
      oQueFalar: "manda a sua pergunta aqui na caixinha que eu respondo",
    };

    function cartoes(...extra: CartaoStory[]): CartaoStory[] {
      return [{ ...CARTAO_OK, figurinha: "perguntas" }, ...extra, ULTIMO_CARTAO_OK];
    }

    it("aprova de 2 a 5 cartoes, com figurinha, texto na tela e o ultimo pedindo resposta", () => {
      const r = verificarLocalmente({}, { formato: "story", cartoes: cartoes() });
      expect(r.aprovado).toBe(true);
    });

    it("reprova com 1 cartao so", () => {
      const r = verificarLocalmente({}, { formato: "story", cartoes: [ULTIMO_CARTAO_OK] });
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-03");
    });

    it("reprova com 6 cartoes", () => {
      const r = verificarLocalmente(
        {},
        { formato: "story", cartoes: cartoes(CARTAO_OK, CARTAO_OK, CARTAO_OK, CARTAO_OK) },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-03");
    });

    it("reprova cartao com mais de 15s de fala (2,5 palavras por segundo)", () => {
      const falaLonga = Array.from({ length: 40 }, () => "palavra").join(" ");
      const r = verificarLocalmente(
        {},
        { formato: "story", cartoes: cartoes({ ...CARTAO_OK, oQueFalar: falaLonga }) },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("ate 15s de fala");
    });

    it("reprova cartao sem texto na tela", () => {
      const r = verificarLocalmente(
        {},
        { formato: "story", cartoes: cartoes({ ...CARTAO_OK, textoNaTela: "" }) },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-05");
    });

    it("reprova quando nenhum cartao pede interacao por figurinha", () => {
      const r = verificarLocalmente(
        {},
        {
          formato: "story",
          cartoes: [
            { ...CARTAO_OK, figurinha: "nenhuma" },
            { ...ULTIMO_CARTAO_OK, figurinha: "nenhuma" },
          ],
        },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-04");
    });

    it('reprova quando o ultimo cartao pede para "seguir"', () => {
      const r = verificarLocalmente(
        {},
        {
          formato: "story",
          cartoes: [
            { ...CARTAO_OK, figurinha: "perguntas" },
            { ...ULTIMO_CARTAO_OK, oQueFalar: "segue a gente para nao perder" },
          ],
        },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-01");
    });

    it("reprova quando o ultimo cartao nao fecha pedindo resposta", () => {
      const r = verificarLocalmente(
        {},
        {
          formato: "story",
          cartoes: [{ ...CARTAO_OK, figurinha: "perguntas" }, { ...CARTAO_OK, oQueFalar: "e so isso por hoje" }],
        },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-07");
    });

    // V9d, item 0: achado do golden set de Stories com chave real, depois do ajuste do prompt
    // ("qual dos dois você já usou aí em casa?" fecha pedindo resposta sem nenhum verbo da lista fixa).
    it("aprova quando o ultimo cartao fecha com uma pergunta direta, mesmo sem nenhum verbo da lista fixa", () => {
      const r = verificarLocalmente(
        {},
        {
          formato: "story",
          cartoes: [
            { ...CARTAO_OK, figurinha: "enquete" },
            { ...CARTAO_OK, oQueFalar: "qual dos dois voce ja usou ai em casa?" },
          ],
        },
      );
      expect(r.aprovado).toBe(true);
    });

    // V9d, item 0, segunda rodada do mesmo golden set com chave real: "me conta aqui qual e a
    // mancha" fecha pedindo resposta (imperativo, sem "?" e sem nenhum verbo da lista antiga).
    it("aprova quando o ultimo cartao pede resposta no imperativo, com 'conta'", () => {
      const r = verificarLocalmente(
        {},
        {
          formato: "story",
          cartoes: [
            { ...CARTAO_OK, figurinha: "perguntas" },
            { ...CARTAO_OK, oQueFalar: "se voce ja passou por isso, me conta aqui qual e a mancha que esta te incomodando" },
          ],
        },
      );
      expect(r.aprovado).toBe(true);
    });

    it("em reels (sem formato story), nao roda checagem de cartao nenhuma mesmo se cartoes vier preenchido", () => {
      const r = verificarLocalmente({}, { cartoes: [ULTIMO_CARTAO_OK] });
      expect(r.aprovado).toBe(true);
    });
  });

  // V9d, item 1: o schema 2.0.0 aceita nulo nos quatro campos de reels e em cartoes, pensado para o
  // outro formato; sem esta checagem, um roteiro em branco (o formato errado devolvendo nulo) passava
  // sem ninguem reprovar.
  describe("roteiro vazio (V9d, item 1)", () => {
    it("reprova story com cartoes nulo", () => {
      const r = verificarLocalmente({}, { formato: "story", cartoes: null });
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("cartões");
    });

    it("reprova story com cartoes um array vazio", () => {
      const r = verificarLocalmente({}, { formato: "story", cartoes: [] });
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("cartões");
    });

    it("reprova reels com gancho nulo", () => {
      const r = verificarLocalmente(
        {},
        { formato: "reels", narrativa: { gancho: null, corpo: "corpo ok", chamadaFinal: "comenta ai" } },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("gancho");
    });

    it("reprova reels com corpo vazio", () => {
      const r = verificarLocalmente(
        {},
        { formato: "reels", narrativa: { gancho: "gancho ok", corpo: "", chamadaFinal: "comenta ai" } },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("corpo");
    });

    it("reprova reels com chamadaFinal nula", () => {
      const r = verificarLocalmente(
        {},
        { formato: "reels", narrativa: { gancho: "gancho ok", corpo: "corpo ok", chamadaFinal: null } },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("chamadaFinal");
    });

    it("aprova reels com os tres campos preenchidos", () => {
      const r = verificarLocalmente(
        {},
        { formato: "reels", narrativa: { gancho: "gancho ok", corpo: "corpo ok", chamadaFinal: "comenta ai" } },
      );
      expect(r.aprovado).toBe(true);
    });

    it("sem narrativa (nao informada), nao reprova por isso mesmo em reels", () => {
      const r = verificarLocalmente({}, { formato: "reels" });
      expect(r.aprovado).toBe(true);
    });
  });

  describe("porQueAssim (V9c, item 3)", () => {
    it("aprova quando toda regra citada existe na lista", () => {
      const r = verificarLocalmente(
        {},
        { porQueAssim: [{ regra: "R-IG-STORY-04", motivo: "pediu enquete para lembrar da marca" }] },
      );
      expect(r.aprovado).toBe(true);
    });

    it("reprova quando cita uma regra que nao existe na lista", () => {
      const r = verificarLocalmente(
        {},
        { porQueAssim: [{ regra: "R-IG-STORY-99", motivo: "regra inventada" }] },
      );
      expect(r.aprovado).toBe(false);
      expect(r.motivos.join(" ")).toContain("R-IG-STORY-99");
    });

    it("sem porQueAssim, nao reprova nada", () => {
      const r = verificarLocalmente({});
      expect(r.aprovado).toBe(true);
    });

    it("porQueAssim vazio (Reels nesta rodada), nao reprova nada", () => {
      const r = verificarLocalmente({}, { porQueAssim: [] });
      expect(r.aprovado).toBe(true);
    });
  });
});

describe("palavrasDeConteudo (V9a, item 2)", () => {
  it("so palavras de 4 ou mais letras, minusculas, sem acento, sem repetir", () => {
    expect(palavrasDeConteudo("Estou no Aeroporto, no aeroporto, as 5h")).toEqual(["aeroporto"]);
  });

  it("tira as palavras de parada (para, esta, aqui, muito, hoje...) mesmo com 4 letras ou mais", () => {
    expect(palavrasDeConteudo("estou aqui hoje muito ansiosa")).toEqual(["ansiosa"]);
  });

  it("string vazia devolve lista vazia", () => {
    expect(palavrasDeConteudo("")).toEqual([]);
  });
});

describe("gerarComVerificacao", () => {
  afterEach(() => {
    gerarEstruturadoMock.mockReset();
    registrarGeracaoMock.mockClear();
  });

  const parametrosBase = {
    tarefa: "roteiro" as const,
    nivel: "forte" as const,
    schema: z.object({ corpo: z.string() }),
    sistemaEstavel: "sistema estavel",
    versaoPrompt: "1.0.0",
    extrairCampos: (dados: { corpo: string }) => ({ corpo: dados.corpo }),
  };

  it("reprova a primeira tentativa, refaz com o motivo anexado, e devolve a segunda quando aprova", async () => {
    gerarEstruturadoMock
      .mockResolvedValueOnce({
        dados: { corpo: "texto ruim \u2014 com travessao" },
        modelo: "mock",
        ...usoZero,
      })
      .mockResolvedValueOnce({ dados: { corpo: "texto limpo" }, modelo: "mock", ...usoZero })
      .mockResolvedValueOnce({
        dados: { aprovado: true, motivo: null },
        modelo: "mock",
        ...usoZero,
      });

    const resultado = await gerarComVerificacao({ ...parametrosBase, entrada: "entrada original" });

    expect(resultado).toEqual({ dados: { corpo: "texto limpo" }, geracaoId: 1 });
    expect(gerarEstruturadoMock).toHaveBeenCalledTimes(3);

    const segundaChamada = gerarEstruturadoMock.mock.calls[1][0] as { entrada: string };
    expect(segundaChamada.entrada).toContain("reprovada");
    expect(segundaChamada.entrada).toContain("travessao");

    // as duas tentativas da tarefa real ficam registradas, mais a chamada de verificarTexto
    expect(registrarGeracaoMock).toHaveBeenCalledTimes(3);
  });

  it("lanca ErroIA quando as duas tentativas reprovam na checagem local", async () => {
    gerarEstruturadoMock.mockResolvedValue({
      dados: { corpo: "sempre ruim \u2014 com travessao" },
      modelo: "mock",
      ...usoZero,
    });

    await expect(
      gerarComVerificacao({ ...parametrosBase, entrada: "entrada original" }),
    ).rejects.toThrow(ErroIA);

    // nunca chega a chamar a tarefa verificarTexto, pois reprova local nas duas vezes
    expect(gerarEstruturadoMock).toHaveBeenCalledTimes(2);
    expect(registrarGeracaoMock).toHaveBeenCalledTimes(2);
  });
});
