/**
 * E27, parte 1, item 3: `montarEntrada` com o motivo da reprovação (dois
 * motivos e nenhum). O resto do prompt (evidência, roteiros recentes) já é
 * coberto pelo golden set e pelos testes de integração de `roteiro.ts`.
 */
import { describe, expect, it } from "vitest";

import { OBJETIVOS_EM_ORDEM } from "@/ia/enums";
import { JARGAO } from "@/lib/regras-de-texto";

import { montarEntrada, montarSistemaEstavel, type InstrucaoAbertura } from "./roteiro";

// OBJETIVOS_EM_ORDEM[2] (nao o literal, checar-texto varre este diretorio): o objetivo
// "gente me chamar para comprar" (`NOME_OBJETIVO`), o mesmo que a asserção abaixo confere.
const SEM_INSTRUCAO_ABERTURA: InstrucaoAbertura = { tipo: null, tiposProibidos: [] };
const BASE = {
  tema: "o erro que faz a mancha voltar",
  objetivo: OBJETIVOS_EM_ORDEM[2],
  formato: "reels" as const,
  evidencias: [],
  roteirosRecentes: [],
  instrucaoAbertura: SEM_INSTRUCAO_ABERTURA,
};

describe("montarEntrada", () => {
  it("sem anguloParaEvitar, nao menciona reprovacao nenhuma", () => {
    const entrada = montarEntrada(BASE);
    expect(entrada).not.toContain("reprovou");
  });

  it("com dois motivos e motivoTexto, nomeia os dois motivos, o texto livre e trava o objetivo", () => {
    const entrada = montarEntrada({
      ...BASE,
      anguloParaEvitar: {
        gancho: "gancho antigo",
        corpo: "corpo antigo",
        motivos: ["Gancho fraco", "Muito longo"],
        motivoTexto: "comeca devagar demais",
      },
    });

    expect(entrada).toContain("O cliente reprovou a versão anterior por: Gancho fraco, Muito longo.");
    expect(entrada).toContain("O que ele escreveu: comeca devagar demais.");
    expect(entrada).toContain("continua: gente me chamar para comprar");
    expect(entrada).toContain("gancho: gancho antigo");
    expect(entrada).toContain("corpo: corpo antigo");
  });

  it("com um motivo e sem motivoTexto, nao inventa um 'o que ele escreveu'", () => {
    const entrada = montarEntrada({
      ...BASE,
      anguloParaEvitar: { gancho: "g", corpo: "c", motivos: ["Já falei disso"] },
    });

    expect(entrada).toContain("O cliente reprovou a versão anterior por: Já falei disso.");
    expect(entrada).not.toContain("O que ele escreveu");
  });
});

// V4, item 3: a instrução de abertura que o serviço decidiu, formatada na entrada.
describe("montarEntrada, instrucaoAbertura", () => {
  it("com tipo e gancho de exemplo, instrui o tipo e cita o exemplo sem pedir para copiar", () => {
    const entrada = montarEntrada({
      ...BASE,
      instrucaoAbertura: { tipo: "resultado", ganchoExemplo: "olha o antes e o depois" },
    });

    expect(entrada).toContain("Tipo de abertura: resultado,");
    expect(entrada).toContain("nunca copie a frase");
    expect(entrada).toContain("olha o antes e o depois");
  });

  it("com tipo e sem exemplo, instrui o tipo sem inventar um vídeo", () => {
    const entrada = montarEntrada({
      ...BASE,
      instrucaoAbertura: { tipo: "numero", ganchoExemplo: null },
    });

    expect(entrada).toContain("Tipo de abertura: numero,");
    expect(entrada).not.toContain("Um vídeo de hoje abriu assim");
  });

  it("sem tipo e com proibidos, so lista o que evitar", () => {
    const entrada = montarEntrada({
      ...BASE,
      instrucaoAbertura: { tipo: null, tiposProibidos: ["cena", "pergunta"] },
    });

    expect(entrada).toContain("Tipo de abertura: livre");
    expect(entrada).toContain("menos estes");
    expect(entrada).toContain("cena, pergunta");
  });

  it("sem tipo e sem proibidos (nicho novo), nao restringe nada", () => {
    const entrada = montarEntrada({
      ...BASE,
      instrucaoAbertura: { tipo: null, tiposProibidos: [] },
    });

    expect(entrada).toContain("Tipo de abertura: livre, o que fizer mais sentido");
  });

  // V9a, item 1, 2 e 4: com momento a entrada muda de forma (sem "Tema escolhido" nem bloco de evidência).
  describe("momento (V9a)", () => {
    const MOMENTO = {
      onde: "no aeroporto",
      oQueEstaAcontecendo: "esperando o embarque para a feira de fornecedores",
      oQueDaParaMostrar: "a fila do check-in e a mala de amostras",
    };

    it("sem momento, a entrada tem 'Tema escolhido' e o bloco de evidencia", () => {
      const entrada = montarEntrada(BASE);
      expect(entrada).toContain("Tema escolhido: o erro que faz a mancha voltar");
      expect(entrada).toContain("Não há vídeo fora da curva");
    });

    it("com momento, a entrada nao tem 'Tema escolhido' nem bloco de evidencia, so o bloco do momento", () => {
      const entrada = montarEntrada({ ...BASE, momento: MOMENTO });

      expect(entrada).not.toContain("Tema escolhido:");
      expect(entrada).not.toContain("Não há vídeo fora da curva");
      expect(entrada).not.toContain("Evidencia disponivel");
      expect(entrada).toContain("O momento que a pessoa descreveu agora:");
      expect(entrada).toContain("Onde: no aeroporto");
      expect(entrada).toContain("O que está acontecendo: esperando o embarque para a feira de fornecedores");
      expect(entrada).toContain("O que dá para mostrar: a fila do check-in e a mala de amostras");
    });

    it("com contextoDeSerie, lista o que ja foi gravado nesta sequencia", () => {
      const entrada = montarEntrada({
        ...BASE,
        momento: MOMENTO,
        contextoDeSerie: [{ tema: "sobre a fabrica", gancho: "aqui dentro da fabrica" }],
      });

      expect(entrada).toContain("O que já foi gravado nesta sequência de momentos");
      expect(entrada).toContain('"sobre a fabrica", gancho: "aqui dentro da fabrica"');
    });

    it("sem contextoDeSerie (primeiro momento), nao menciona sequencia nenhuma", () => {
      const entrada = montarEntrada({ ...BASE, momento: MOMENTO });
      expect(entrada).not.toContain("sequência de momentos");
    });

    it("com marcaCitada, leva o nome e o perfil dela, com a regra dura 11", () => {
      const entrada = montarEntrada({
        ...BASE,
        momento: MOMENTO,
        marcaCitada: { nome: "Cera Boa", perfilCompilado: "vende cera automotiva artesanal" },
      });

      expect(entrada).toContain("Marca citada por quem está gravando");
      expect(entrada).toContain("Cera Boa: vende cera automotiva artesanal");
    });

    it("sem marcaCitada, nao menciona marca nenhuma", () => {
      const entrada = montarEntrada({ ...BASE, momento: MOMENTO });
      expect(entrada).not.toContain("Marca citada");
    });
  });
});

// V9c, item 2: com formato "story" a linha "Tipo de abertura" nunca entra (regra dura 9, o
// primeiro cartão tem regra própria, R-IG-STORY-02).
describe("montarEntrada, formato story", () => {
  it("nao inclui a linha de tipo de abertura", () => {
    const entrada = montarEntrada({
      ...BASE,
      formato: "story",
      instrucaoAbertura: { tipo: "resultado", ganchoExemplo: "olha o antes e o depois" },
    });
    expect(entrada).not.toContain("Tipo de abertura");
  });

  it("em reels, a linha de tipo de abertura continua presente", () => {
    const entrada = montarEntrada({
      ...BASE,
      formato: "reels",
      instrucaoAbertura: { tipo: "resultado", ganchoExemplo: "olha o antes e o depois" },
    });
    expect(entrada).toContain("Tipo de abertura");
  });
});

// E27, parte 2, item 3: sem nenhuma regra o bloco nao aparece; com regra, aparece com o
// rotulo firme (contagem >= 2) ou fraca (contagem 1).
describe("montarSistemaEstavel", () => {
  const BASE_SISTEMA = {
    perfilCompilado: "perfil do cliente",
    modeloNicho: "modelo do nicho",
    camadaExclusiva: "camada exclusiva",
    tipo: "negocio" as const,
    formato: "reels" as const,
  };

  it("sem regrasCliente, nao monta o bloco da memoria", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, regrasCliente: [] });
    expect(sistema).not.toContain("siga a regra 8");
  });

  it("com regrasCliente, lista cada regra com firme (contagem >= 2) ou fraca (contagem 1)", () => {
    const sistema = montarSistemaEstavel({
      ...BASE_SISTEMA,
      regrasCliente: [
        { regra: "nao comecar com pergunta", contagem: 2 },
        { regra: "nao citar concorrente", contagem: 1 },
      ],
    });

    expect(sistema).toContain("siga a regra 8: a firme vale como proibição, a fraca deve ser evitada");
    expect(sistema).toContain("- nao comecar com pergunta (firme)");
    expect(sistema).toContain("- nao citar concorrente (fraca)");
  });

  // V9b, item 0.1 (revisao do PR #55): "negocio" pode usar a primeira pessoa do singular quando
  // quem grava conta a propria experiencia; so nao pode inventar um "nos" que nao existe.
  it("tipo negocio: instrui a voz da marca, mas permite primeira pessoa do singular na experiencia de quem grava", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, regrasCliente: [], tipo: "negocio" });
    expect(sistema).toContain('a voz é a da marca ("a gente", "nossa loja") quando fala do negócio');
    expect(sistema).toContain('primeira pessoa do singular é bem-vinda quando quem grava conta a própria experiência');
    expect(sistema).toContain('nunca invente um "nós" que não existe');
  });

  it("tipo pessoa: instrui primeira pessoa do singular", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, regrasCliente: [], tipo: "pessoa" });
    expect(sistema).toContain('escreva sempre em primeira pessoa do singular ("eu", "meu", "minha")');
  });

  // V9b, item 0.3 (revisao do PR #55): a regra dura 11 ganhou "uma marca so" na chamada final.
  it("regra 11 sempre diz que a chamada final cita uma marca so", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, regrasCliente: [], tipo: "negocio" });
    expect(sistema).toContain("sempre cita uma marca só, nunca as duas.");
  });
});

// V9c, item 2: formato "story" troca a regra 5, a regra 9 e o paragrafo de estrutura pelo
// bloco de cartoes com as regras R-IG-STORY, citadas por numero.
describe("montarSistemaEstavel, formato story", () => {
  const BASE_SISTEMA = {
    perfilCompilado: "perfil do cliente",
    modeloNicho: "modelo do nicho",
    camadaExclusiva: "camada exclusiva",
    tipo: "negocio" as const,
    regrasCliente: [],
  };

  it("troca a estrutura de reels por cartoes numerados", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    expect(sistema).toContain("cartões numerados");
    expect(sistema).not.toContain("gancho nos primeiros segundos, corpo, fechamento, chamada final");
  });

  it("cita as regras R-IG-STORY pelo numero", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    expect(sistema).toContain("R-IG-STORY-01");
    expect(sistema).toContain("R-IG-STORY-10");
  });

  it("pede o preenchimento de porQueAssim", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    expect(sistema).toContain("porQueAssim");
  });

  it("diz que nao existe tipo de abertura em story", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    expect(sistema).toContain("não existe \"tipo de abertura\"");
  });

  it("em reels, mantem a estrutura classica e nao cita regras R-IG-STORY", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "reels" });
    expect(sistema).toContain("gancho nos primeiros segundos, corpo, fechamento, chamada final");
    expect(sistema).not.toContain("R-IG-STORY-01");
  });

  // V9d, item 0: o golden set de Stories (rodado pelo Fable em 25/09 com chave real) reprovou 5 de 5,
  // sempre pelos mesmos tres motivos do prompt. Os tres testes abaixo travam a correcao de cada um.
  // A regra R-IG-STORY-03 (texto copiado da rubrica, nao reescrito) ainda fala em segundos como
  // contexto; o que muda e a instrucao de verdade da regra 5 e do bloco de estrutura, que agora dao
  // o numero de palavras direto (o modelo conta palavras, nao segundos).
  it("regra 5 e o bloco de estrutura dizem o numero de palavras direto", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    expect(sistema).toContain("no máximo 35 palavras de fala");
  });

  it("porQueAssim so aceita regra R-IG-STORY, nunca as regras duras numeradas de 1 a 12", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    expect(sistema).toContain("nunca as regras duras numeradas de 1 a 12");
  });

  it("porQueAssim proibe cada palavra do catalogo de jargao, montado em tempo de execucao", () => {
    const sistema = montarSistemaEstavel({ ...BASE_SISTEMA, formato: "story" });
    for (const item of JARGAO) {
      expect(sistema).toContain(`nunca "${item.palavra}"`);
    }
  });
});
