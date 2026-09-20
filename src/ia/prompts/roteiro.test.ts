/**
 * E27, parte 1, item 3: `montarEntrada` com o motivo da reprovação (dois
 * motivos e nenhum). O resto do prompt (evidência, roteiros recentes) já é
 * coberto pelo golden set e pelos testes de integração de `roteiro.ts`.
 */
import { describe, expect, it } from "vitest";

import { OBJETIVOS_EM_ORDEM } from "@/ia/enums";

import { montarEntrada, montarSistemaEstavel, type InstrucaoAbertura } from "./roteiro";

// OBJETIVOS_EM_ORDEM[2] (nao o literal, checar-texto varre este diretorio): o objetivo
// "gente me chamar para comprar" (`NOME_OBJETIVO`), o mesmo que a asserção abaixo confere.
const SEM_INSTRUCAO_ABERTURA: InstrucaoAbertura = { tipo: null, tiposProibidos: [] };
const BASE = {
  tema: "o erro que faz a mancha voltar",
  objetivo: OBJETIVOS_EM_ORDEM[2],
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
});

// E27, parte 2, item 3: sem nenhuma regra o bloco nao aparece; com regra, aparece com o
// rotulo firme (contagem >= 2) ou fraca (contagem 1).
describe("montarSistemaEstavel", () => {
  const BASE_SISTEMA = {
    perfilCompilado: "perfil do cliente",
    modeloNicho: "modelo do nicho",
    camadaExclusiva: "camada exclusiva",
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
});
