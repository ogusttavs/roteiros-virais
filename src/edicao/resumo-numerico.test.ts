import { describe, expect, it } from "vitest";

import type { DecisaoDaEdicao } from "@/db/schema";

import { resumoNumericoDaSaida } from "./resumo-numerico";

const decisao: DecisaoDaEdicao = {
  trechos: [
    { deIndice: 0, ateIndice: 4, motivo: "ele fala do preço de 3.956 reais", transicao: "nenhuma" },
    { deIndice: 10, ateIndice: 19, motivo: "mostra o produto", transicao: "combinar" },
  ],
  gancho: { deIndice: 0, ateIndice: 4, tentativasDescartadas: 2, porQue: "a frase de abertura sobre a mancha" },
  titulo: { texto: "Por que a mancha volta", subtitulo: "e como sair" },
  correcoesDaLegenda: [{ de: "uosh", para: "Wash" }],
  avisos: ["Você falou 3.956 e o roteiro diz 3.976"],
};

describe("resumoNumericoDaSaida: a fala da pessoa nunca vai para o registro de IA", () => {
  it("a decisão vira só contagens e índices", () => {
    const resumo = resumoNumericoDaSaida("decidirEdicao", decisao);
    expect(resumo).toEqual({ trechos: 2, palavrasMantidas: 15, ganchoDeIndice: 0, ganchoAteIndice: 4, ganchoTentativasDescartadas: 2, correcoesDaLegenda: 1, avisos: 1, temSubtitulo: true });
    expect(JSON.stringify(resumo)).not.toMatch(/mancha|preço|uosh|3\.956/i);
  });

  it("o verificador vira contagens por tipo e aprovado ou reprovado, sem descrição nem sugestão", () => {
    const saida = {
      problemas: [
        { onde: "legenda", bloco: 2, tipo: "nome_errado", gravidade: "reprova", descricao: "escreveu Uosh no lugar de Wash", sugestao: "Wash" },
        { onde: "titulo", bloco: null, tipo: "gramatica", gravidade: "aviso", descricao: "falta vírgula", sugestao: null },
      ],
    };
    const resumo = resumoNumericoDaSaida("verificarEdicao", saida);
    expect(resumo).toEqual({ problemas: 2, reprovam: 1, avisos: 1, aprovado: false, porTipo: { nome_errado: 1, gramatica: 1 } });
    expect(JSON.stringify(resumo)).not.toMatch(/Uosh|Wash|vírgula/);
    expect(resumoNumericoDaSaida("verificarEdicao", { problemas: [] })).toMatchObject({ problemas: 0, aprovado: true });
  });

  it("uma saída que não tem o formato esperado, ou outra tarefa, não guarda nada", () => {
    expect(resumoNumericoDaSaida("decidirEdicao", { qualquer: "texto da fala" })).toEqual({});
    expect(resumoNumericoDaSaida("outraTarefa", decisao)).toEqual({});
    expect(resumoNumericoDaSaida("verificarEdicao", null)).toEqual({});
  });
});
