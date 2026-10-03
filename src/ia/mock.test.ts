import { describe, expect, it } from "vitest";

import { encontrarProblemas } from "@/lib/regras-de-texto";

import { construirSaidaMock } from "./mock";
import * as analisarPerfilCitadoIA from "./prompts/analisarPerfilCitado";
import * as avaliarRespostaIA from "./prompts/avaliarResposta";
import * as organizarFalaBriefingIA from "./prompts/organizarFalaBriefing";

describe("mock de avaliarResposta", () => {
  const entrada = avaliarRespostaIA.montarEntrada({
    pergunta: "O que o seu negocio faz?",
    oQueAIAProcura: "um exemplo concreto",
    resposta: "Vendo produtos de limpeza feitos por mim, com nota 10 dos clientes.",
  });

  it("inclui exemplo, e o mock inteiro valida contra o schema real da tarefa", () => {
    const saida = avaliarRespostaIA.schema.parse(construirSaidaMock("avaliarResposta", entrada));
    expect(saida.exemplo).toBeTruthy();
    expect(typeof saida.exemplo).toBe("string");
  });

  it("o exemplo tambem passa pelas regras de texto (sem travessao, emoji ou jargao)", () => {
    const saida = avaliarRespostaIA.schema.parse(construirSaidaMock("avaliarResposta", entrada));
    expect(encontrarProblemas(saida.exemplo)).toEqual([]);
  });
});

/**
 * P2, item 3: "nao inventa, nao corta pela metade" (`PROXIMO.md`, definicao de pronto). O mock so
 * tira as muletas de fala por regex, entao as duas garantias valem por construcao; os testes
 * abaixo sao a rede de seguranca contra uma mudanca futura no mock que quebre isso sem querer.
 */
describe("mock de organizarFalaBriefing", () => {
  const FALA_DE_EXEMPLO =
    "Então assim, eu atendo, tipo, bastante gente que liga perguntando, é, se a gente faz orcamento pelo whatsapp mesmo, e eu falo que sim, né, sempre respondo no mesmo dia";

  it("tira as muletas de fala mas mantem as palavras da pessoa", () => {
    const entrada = organizarFalaBriefingIA.montarEntrada({ pergunta: "Como voce atende os clientes?", textoFalado: FALA_DE_EXEMPLO });
    const saida = organizarFalaBriefingIA.schema.parse(construirSaidaMock("organizarFalaBriefing", entrada));

    expect(saida.textoOrganizado).not.toMatch(/\bentão assim\b/i);
    expect(saida.textoOrganizado).not.toMatch(/\btipo\b/i);
    expect(saida.textoOrganizado).not.toMatch(/\bné\b/i);
    expect(saida.textoOrganizado).toContain("atendo");
    expect(saida.textoOrganizado).toContain("whatsapp");
    expect(saida.textoOrganizado).toContain("sempre respondo no mesmo dia");
  });

  it("nao inventa fato novo: todo trecho do resultado ja existia na fala (o mock so remove, nunca acrescenta)", () => {
    const entrada = organizarFalaBriefingIA.montarEntrada({ pergunta: "Como voce atende os clientes?", textoFalado: FALA_DE_EXEMPLO });
    const saida = organizarFalaBriefingIA.schema.parse(construirSaidaMock("organizarFalaBriefing", entrada));

    for (const trecho of saida.textoOrganizado.split(/\s+/)) {
      expect(FALA_DE_EXEMPLO).toContain(trecho);
    }
  });

  it("nao corta para menos da metade do tamanho falado", () => {
    const entrada = organizarFalaBriefingIA.montarEntrada({ pergunta: "Como voce atende os clientes?", textoFalado: FALA_DE_EXEMPLO });
    const saida = organizarFalaBriefingIA.schema.parse(construirSaidaMock("organizarFalaBriefing", entrada));

    expect(saida.textoOrganizado.length).toBeGreaterThanOrEqual(FALA_DE_EXEMPLO.length / 2);
  });

  it("fala sem nenhuma muleta passa praticamente igual", () => {
    const falaLimpa = "Eu atendo bastante gente pelo whatsapp e respondo sempre no mesmo dia";
    const entrada = organizarFalaBriefingIA.montarEntrada({ pergunta: "Como voce atende os clientes?", textoFalado: falaLimpa });
    const saida = organizarFalaBriefingIA.schema.parse(construirSaidaMock("organizarFalaBriefing", entrada));

    expect(saida.textoOrganizado).toBe(falaLimpa);
  });
});

/** E38, partes 2 e 3: a leitura curta de um perfil citado ou da propria marca. */
describe("mock de analisarPerfilCitado", () => {
  it("com titulos: cita o handle e diz que ha assunto repetido, e a saida valida contra o schema real", () => {
    const entrada = analisarPerfilCitadoIA.montarEntrada({
      tipo: "concorrente",
      nomeDoCliente: "Loja Exemplo",
      oQueVende: "produtos de limpeza",
      handle: "concorrente_exemplo",
      titulos: ["Como limpar o box", "Dica de limpeza rapida"],
    });
    const saida = analisarPerfilCitadoIA.schema.parse(construirSaidaMock("analisarPerfilCitado", entrada));

    expect(saida.leitura).toContain("@concorrente_exemplo");
    expect(encontrarProblemas(saida.leitura)).toEqual([]);
  });

  it("sem nenhum titulo (perfil sem video recente): diz que nao tinha o que ler, sem inventar assunto", () => {
    const entrada = analisarPerfilCitadoIA.montarEntrada({
      tipo: "propria_marca",
      nomeDoCliente: "Loja Exemplo",
      oQueVende: "produtos de limpeza",
      handle: "loja_exemplo",
      titulos: [],
    });
    const saida = analisarPerfilCitadoIA.schema.parse(construirSaidaMock("analisarPerfilCitado", entrada));

    expect(saida.leitura).toContain("@loja_exemplo");
    expect(saida.leitura).toContain("não tinha vídeo recente");
  });
});
