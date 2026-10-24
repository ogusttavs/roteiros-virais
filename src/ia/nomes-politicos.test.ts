/**
 * E59: o que `acharNomePolitico` pega e, igualmente importante, o que deixa passar (a regra reprova nas duas tentativas, então falso alarme derruba a geração de quem não falou de política).
 * A conferência da lista contra o original do TSE roda só quando o repositório de documentos está ao lado (na CI não está).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FEDERACOES_TSE, PARTIDOS_TSE } from "@/config/partidos-tse";

import { acharNomePolitico } from "./nomes-politicos";

const CAMINHO_TSE = path.resolve(process.cwd(), "../pesquisa/partidos/partidos-registrados-tse.json");

describe("a lista de partidos copiada do TSE", () => {
  it("tem os 30 partidos registrados e as 5 federações", () => {
    expect(PARTIDOS_TSE).toHaveLength(30);
    expect(FEDERACOES_TSE).toHaveLength(5);
    expect(new Set(PARTIDOS_TSE.map((p) => p.numero)).size).toBe(30);
  });

  it.skipIf(!existsSync(CAMINHO_TSE))("é igual ao original guardado em pesquisa/partidos", () => {
    const original = JSON.parse(readFileSync(CAMINHO_TSE, "utf8")) as { partidos: { numero: number; sigla: string; nome: string }[]; federacoes: { nome: string }[] };
    expect(PARTIDOS_TSE).toEqual(original.partidos);
    expect(FEDERACOES_TSE).toEqual(original.federacoes.map((f) => f.nome));
  });
});

describe("partido: o que reprova", () => {
  it.each([
    ["O PSDB e o PSOL discordam nesse ponto.", "PSDB"],
    ["votou no Partido dos Trabalhadores por anos", "partido dos trabalhadores"],
    ["quem é do partido liberal pensa diferente", "partido liberal"],
    ["a Federação Brasil da Esperança lançou a chapa", "federacao brasil da esperanca"],
    ["Movimento Democrático Brasileiro", "movimento democratico brasileiro"],
    ["União Brasil e Progressistas disputam as eleições", "uniao brasil"],
    ["o voto da Rede Sustentabilidade no congresso", "rede sustentabilidade"],
    ["o partido Democracia Cristã lançou candidato", "democracia crista"],
    ["os dois são do PT e do PL, nas eleições", "PT"],
    ["na eleição, o candidato do PL perdeu", "PL"],
    ["filiado ao Novo desde 2018", "novo"],
    ["o partido Podemos apoiou", "podemos"],
    ["a legenda PP ficou fora", "pp"],
    ["fala do PCdoB", "PCdoB"],
    ["ele é do PC do B", "PC do B"],
  ])("%s", (texto, esperado) => {
    const achado = acharNomePolitico(texto);
    expect(achado?.tipo).toBe("partido");
    expect(achado?.trecho).toBe(esperado);
  });
});

describe("partido: o que passa (conversa de negócio, sem falar de política)", () => {
  it.each([
    "Sou PT, personal trainer, e treino gente de 50 anos.",
    "Abra o arquivo PSD no Photoshop e exporte em PNG.",
    "A placa PCB precisa de solda limpa.",
    "O projeto de lei PL 2630 não é o assunto aqui.",
    "Lançamos um produto novo e agora podemos entregar no mesmo dia.",
    "O NOVO kit chegou. Agir rápido evita a mancha e a gente avança com cuidado.",
    "A cidadania italiana exige documentos; avante com o processo.",
    "Painel PV e sistema de polipropileno PP para a obra.",
    "Fale com o dono do negócio. Rede de lojas da região, união da família.",
    "duas figuras eleitorais muito conhecidas, uma de cada lado",
    "o deputado mais votado da sua cidade",
    "o presidente da associação de moradores abriu a reunião",
    "Montamos uma rede sustentabilidade de lojas parceiras que reaproveita embalagem.",
    "A união Brasil-Argentina no comércio abriu mercado para o nosso produto.",
    "A União Brasil de franqueados se reúne toda segunda; a Rede Sustentabilidade da nossa loja começou em março.",
    "A democracia cristã de valores da nossa família guia o atendimento.",
  ])("%s", (texto) => {
    expect(acharNomePolitico(texto)).toBeNull();
  });
});

describe("partido de nome comum: precisa de palavra de política por perto (R-CONF-10, achado 8 da revisão de 24/10/2026)", () => {
  it("política longe do nome não conta: o voto de confiança lá no começo não faz a rede de lojas virar partido", () => {
    const longe = `Meu cliente deu voto de confiança. ${"Falamos de preço, prazo e garantia. ".repeat(6)}Hoje a Rede Sustentabilidade das nossas lojas ajuda o bairro.`;
    expect(acharNomePolitico(longe)).toBeNull();
  });

  it("política perto do nome conta, em qualquer ordem", () => {
    expect(acharNomePolitico("nessa eleição, a União Brasil lançou chapa")?.trecho).toBe("uniao brasil");
    expect(acharNomePolitico("a Rede Sustentabilidade, partido da ex-ministra")?.trecho).toBe("rede sustentabilidade");
    expect(acharNomePolitico("O deputado só votou com a Democracia Cristã quando precisou.")?.tipo).toBe("partido");
  });

  it("os nomes que começam por Partido e as federações continuam valendo sem contexto", () => {
    expect(acharNomePolitico("Tela: o Partido Verde")?.tipo).toBe("partido");
    expect(acharNomePolitico("a Federação União Progressista foi citada")?.trecho).toBe("federacao uniao progressista");
  });
});

describe("candidato: cargo mais nome próprio", () => {
  it.each([
    ["o deputado Fulano de Tal foi o mais votado", "deputado Fulano"],
    ["A candidata Maria Souza falou na TV", "candidata Maria Souza"],
    ["segundo o senador Beltrano, o preço sobe", "senador Beltrano"],
    ["o Deputado Federal Cicrano apareceu", "deputado Cicrano"],
    ["a prefeita Joana d'Arc anunciou", "prefeita Joana"],
    ["No ano da eleição, o presidente Zeca Pereira discursou", "presidente Zeca Pereira"],
  ])("%s", (texto, esperado) => {
    const achado = acharNomePolitico(texto);
    expect(achado?.tipo).toBe("candidato");
    expect(achado?.trecho).toBe(esperado);
  });

  it.each([
    "o candidato mais votado da sua cidade",
    "o deputado federal eleito pela região",
    "a prefeita Municipal só existe na lei",
    "Candidato. Hoje o assunto é outro",
    "o presidente Roberto assinou o contrato da loja",
    "um vereador do seu bairro, de cada lado",
    "mostre a foto do deputado mais votado",
  ])("passa: %s", (texto) => {
    expect(acharNomePolitico(texto)).toBeNull();
  });
});
